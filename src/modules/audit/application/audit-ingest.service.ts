import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { EventEnvelope } from '../../../core/events/envelope/event-envelope';
import { HARD_DENIED_ACTIONS } from '../audit.constants';
import type { AuditEntryDraft } from '../domain/audit-entry.model';
import {
  AuditActorType,
  AuditScope,
  AuditSource,
} from '../domain/audit-scope.enum';
import { AuditConfigService } from '../config/audit-config.service';
import { AuditQueue } from '../infrastructure/audit.queue';
import { AuditMetrics } from '../observability/audit.metrics';

const REDACTED = '[REDACTED]';
const MAX_REDACTION_DEPTH = 8;

const SOURCE_VALUES: ReadonlySet<string> = new Set(Object.values(AuditSource));

/**
 * Normalises bus envelopes (and direct `record()` drafts) into redacted
 * `AuditEntryDraft`s and enqueues them for asynchronous persistence.
 * Ingestion is a passive sink: it never throws back into the emitter.
 */
@Injectable()
export class AuditIngestService {
  private readonly logger = new Logger('audit.ingest');

  constructor(
    private readonly config: AuditConfigService,
    private readonly queue: AuditQueue,
    private readonly metrics: AuditMetrics,
  ) {}

  /**
   * Entry point for the global bus tap. Deny-listed and recursive actions
   * are skipped; enqueue failures are logged and counted, never rethrown.
   */
  async ingestEnvelope(envelope: EventEnvelope): Promise<void> {
    try {
      if (!this.config.global().ingestEnabled) return;
      if (await this.isDenied(envelope.name, envelope.guildId)) {
        this.metrics.recordIngest('skipped');
        return;
      }
      const draft = this.toDraft(envelope);
      await this.queue.enqueueDraft(this.redactDraft(draft), envelope.id);
      this.logger.debug(`enqueued ${envelope.name} envelope=${envelope.id}`);
    } catch (err) {
      this.metrics.recordIngest('dropped');
      this.logger.warn(
        `dropped ${envelope.name} envelope=${envelope.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Public API: enqueue a caller-built draft (validated, redacted). */
  async record(draft: AuditEntryDraft): Promise<void> {
    this.assertDraft(draft);
    await this.queue.enqueueDraft(this.redactDraft(draft), randomUUID());
  }

  private async isDenied(
    action: string,
    guildId: string | null,
  ): Promise<boolean> {
    if (HARD_DENIED_ACTIONS.has(action)) return true;
    const prefixes = await this.config.denyPrefixesFor(guildId);
    return prefixes.some(
      (prefix) =>
        action === prefix ||
        action.startsWith(`${prefix}.`) ||
        (prefix.endsWith('.') && action.startsWith(prefix)),
    );
  }

  private toDraft(envelope: EventEnvelope): AuditEntryDraft {
    const payload = this.asRecord(envelope.payload);
    const entity = envelope.name.split('.')[1] ?? null;
    const { before, after, metadata } = this.splitPayload(payload);

    return {
      scope: envelope.guildId ? AuditScope.Guild : AuditScope.Global,
      guildId: envelope.guildId,
      action: envelope.name,
      source: this.mapSource(envelope),
      actorId: envelope.actor.type === 'system' ? null : envelope.actor.id,
      actorType: this.mapActorType(envelope.actor.type),
      targetType: this.pickString(payload, 'targetType') ?? entity,
      targetId: this.pickTargetId(payload, entity),
      channelId: this.pickString(payload, 'channelId'),
      correlationId: envelope.correlationId,
      causationId: envelope.causationId,
      summary: `audit:actions.${envelope.name}`,
      metadata: {
        ...metadata,
        ...(envelope.meta ? { meta: envelope.meta } : {}),
        envelopeId: envelope.id,
      },
      before,
      after,
      occurredAt: new Date(envelope.occurredAt),
    };
  }

  private mapSource(envelope: EventEnvelope): AuditSource {
    const metaSource = envelope.meta?.['source'];
    if (typeof metaSource === 'string' && SOURCE_VALUES.has(metaSource)) {
      return metaSource as AuditSource;
    }
    switch (envelope.actor.type) {
      case 'user':
        return envelope.name.startsWith('dashboard.')
          ? AuditSource.Dashboard
          : AuditSource.Command;
      case 'api':
        return AuditSource.Api;
      case 'job':
        return AuditSource.Job;
      case 'discord':
        return AuditSource.Event;
      case 'system':
        return AuditSource.System;
    }
  }

  private mapActorType(type: EventEnvelope['actor']['type']): AuditActorType {
    if (type === 'user') return AuditActorType.User;
    if (type === 'discord') return AuditActorType.Bot;
    return AuditActorType.System;
  }

  private splitPayload(payload: Record<string, unknown>): {
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
  } {
    const { before, after, ...rest } = payload;
    return {
      before: this.asRecordOrNull(before),
      after: this.asRecordOrNull(after),
      metadata: rest,
    };
  }

  private pickTargetId(
    payload: Record<string, unknown>,
    entity: string | null,
  ): string | null {
    return (
      this.pickString(payload, 'targetId') ??
      this.pickString(payload, 'id') ??
      (entity ? this.pickString(payload, `${entity}Id`) : null)
    );
  }

  private pickString(
    payload: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = payload[key];
    return typeof value === 'string' ? value : null;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return this.asRecordOrNull(value) ?? {};
  }

  private asRecordOrNull(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private redactDraft(draft: AuditEntryDraft): AuditEntryDraft {
    const keys = new Set(
      this.config.global().redactMetadataKeys.map((k) => k.toLowerCase()),
    );
    return {
      ...draft,
      metadata: this.redact(draft.metadata, keys, 0) as Record<string, unknown>,
      before: draft.before
        ? (this.redact(draft.before, keys, 0) as Record<string, unknown>)
        : null,
      after: draft.after
        ? (this.redact(draft.after, keys, 0) as Record<string, unknown>)
        : null,
    };
  }

  private redact(
    value: unknown,
    keys: ReadonlySet<string>,
    depth: number,
  ): unknown {
    if (depth >= MAX_REDACTION_DEPTH) return REDACTED;
    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, keys, depth + 1));
    }
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const record = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(record)) {
        out[key] = keys.has(key.toLowerCase())
          ? REDACTED
          : this.redact(val, keys, depth + 1);
      }
      return out;
    }
    return value;
  }

  private assertDraft(draft: AuditEntryDraft): void {
    if (draft.scope === AuditScope.Global && draft.guildId !== null) {
      throw new Error('GLOBAL-scope drafts must not carry a guildId');
    }
    if (draft.scope === AuditScope.Guild && !draft.guildId) {
      throw new Error('GUILD-scope drafts require a guildId');
    }
    if (!draft.action || !draft.correlationId) {
      throw new Error('audit drafts require action and correlationId');
    }
  }
}
