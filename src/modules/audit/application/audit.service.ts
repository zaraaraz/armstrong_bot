import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Readable } from 'stream';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import { AUDIT_CACHE_PREFIX } from '../audit.constants';
import type {
  AuditEntry,
  AuditEntryDraft,
  AuditExportFormat,
  AuditQuery,
  ChainVerificationResult,
  Page,
} from '../domain/audit-entry.model';
import {
  AuditActorType,
  AuditScope,
  AuditSource,
} from '../domain/audit-scope.enum';
import { AuditChainService } from '../domain/audit-chain.service';
import { canonicalJson } from '../domain/canonical-json';
import { AuditConfigService } from '../config/audit-config.service';
import { AuditRepository } from '../infrastructure/audit.repository';
import {
  AuditExportWriter,
  type ExportedEntry,
} from '../infrastructure/audit-export.writer';
import { AuditEventEmitter } from '../events/audit-event.emitter';
import { AuditEvents } from '../events/audit.events';
import { AuditIngestService } from './audit-ingest.service';
import { AuditPublicApi } from './audit.service.contract';
import { AuditMetrics } from '../observability/audit.metrics';
import { AuditTracing } from '../observability/audit.tracing';

interface MetaAuditContext {
  readonly actorId: string;
  readonly source: AuditSource;
}

/**
 * Read/verify/export orchestration over the append-only ledger. Reads are
 * cached with a short TTL; verify and export are themselves audited
 * (meta-audit) so access to the ledger stays accountable.
 */
@Injectable()
export class AuditServiceImpl extends AuditPublicApi {
  private readonly logger = new Logger('audit.service');

  constructor(
    private readonly repo: AuditRepository,
    private readonly chain: AuditChainService,
    private readonly config: AuditConfigService,
    private readonly cache: CacheService,
    private readonly writer: AuditExportWriter,
    private readonly emitter: AuditEventEmitter,
    private readonly ingest: AuditIngestService,
    private readonly metrics: AuditMetrics,
    private readonly tracing: AuditTracing,
  ) {
    super();
  }

  async record(draft: AuditEntryDraft): Promise<void> {
    await this.ingest.record(draft);
  }

  async query(query: AuditQuery): Promise<Page<AuditEntry>> {
    const clamped = this.clamp(query);
    const ttl = this.config.global().queryCacheTtlSeconds;
    if (ttl === 0) return this.repo.find(clamped);

    const key = this.queryCacheKey(clamped);
    const cached = await this.cache.getOrSet(
      key,
      async () => this.toCacheable(await this.repo.find(clamped)),
      { ttlSeconds: ttl },
    );
    return this.fromCacheable(cached);
  }

  async getByCorrelation(
    correlationId: string,
  ): Promise<readonly AuditEntry[]> {
    return this.repo.findByCorrelation(correlationId);
  }

  async verifyChain(
    scope: AuditScope,
    guildId: string | null,
    context?: MetaAuditContext,
  ): Promise<ChainVerificationResult> {
    return this.tracing.withSpan(
      'audit.verify',
      { scope, guildId: guildId ?? 'global' },
      async () => {
        const algorithm = this.config.global().hashAlgorithm;
        const firstSeq = await this.repo.firstSeq(scope, guildId);
        const anchor =
          firstSeq !== null && firstSeq > 1n
            ? await this.repo.findAnchor(scope, guildId, firstSeq - 1n)
            : null;

        const result = await this.chain.verify(
          scope,
          guildId,
          this.repo.iterateChain(scope, guildId),
          algorithm,
          anchor,
        );

        this.metrics.recordVerification(result.valid);
        await this.emitter.emit(
          AuditEvents.ChainVerified,
          {
            scope,
            guildId,
            checked: result.checked,
            valid: result.valid,
            verifiedAt: result.verifiedAt.toISOString(),
          },
          guildId,
        );
        if (!result.valid && result.firstBrokenSeq !== null) {
          await this.emitBroken(scope, guildId, result.firstBrokenSeq);
        }
        await this.metaAudit(
          'audit.verify.performed',
          scope,
          guildId,
          { checked: result.checked, valid: result.valid },
          context,
        );
        return result;
      },
    );
  }

  async export(
    query: AuditQuery,
    format: AuditExportFormat,
    context?: MetaAuditContext,
  ): Promise<NodeJS.ReadableStream> {
    const clamped = this.clamp(query);
    const scope =
      clamped.scope ?? (clamped.guildId ? AuditScope.Guild : AuditScope.Global);
    const guildId = clamped.guildId ?? null;

    this.metrics.recordExport(format);
    await this.emitter.emit(
      AuditEvents.ExportRequested,
      {
        scope,
        guildId,
        format,
        actorId: context?.actorId ?? 'system',
        occurredAt: new Date().toISOString(),
      },
      guildId,
    );
    await this.metaAudit(
      'audit.export.performed',
      scope,
      guildId,
      { format, filters: this.describeFilters(clamped) },
      context,
    );

    const chunks = this.writer.serialise(
      this.repo.streamForExport(clamped),
      format,
    );
    return Readable.from(chunks);
  }

  /** Wire helper reused by the controller for response mapping. */
  toWire(entry: AuditEntry): ExportedEntry {
    return this.writer.toWire(entry);
  }

  private async emitBroken(
    scope: AuditScope,
    guildId: string | null,
    seq: bigint,
  ): Promise<void> {
    const entry = await this.repo.findBySeq(scope, guildId, seq);
    const algorithm = this.config.global().hashAlgorithm;
    const expected = entry
      ? this.chain.computeHash(entry, entry.seq, entry.previousHash, algorithm)
      : 'unknown';
    this.logger.error(
      `audit chain BROKEN scope=${scope} guild=${guildId ?? 'global'} seq=${seq}`,
    );
    await this.emitter.emit(
      AuditEvents.ChainBroken,
      {
        scope,
        guildId,
        expectedHash: expected,
        actualHash: entry?.hash ?? 'missing',
        seq: seq.toString(),
        detectedAt: new Date().toISOString(),
      },
      guildId,
    );
  }

  private async metaAudit(
    action: string,
    scope: AuditScope,
    guildId: string | null,
    metadata: Record<string, unknown>,
    context?: MetaAuditContext,
  ): Promise<void> {
    await this.ingest.record({
      scope,
      guildId,
      action,
      source: context?.source ?? AuditSource.System,
      actorId: context?.actorId ?? null,
      actorType: context ? AuditActorType.User : AuditActorType.System,
      targetType: 'ledger',
      targetId: guildId,
      channelId: null,
      correlationId: randomUUID(),
      causationId: null,
      summary: `audit:actions.${action}`,
      metadata,
      before: null,
      after: null,
      occurredAt: new Date(),
    });
  }

  private clamp(query: AuditQuery): AuditQuery {
    const max = this.config.global().maxPageSize;
    return {
      ...query,
      pagination: {
        page: Math.max(1, query.pagination.page),
        pageSize: Math.min(Math.max(1, query.pagination.pageSize), max),
      },
    };
  }

  private queryCacheKey(query: AuditQuery): string {
    const digest = createHash('sha256')
      .update(canonicalJson(query))
      .digest('hex')
      .slice(0, 32);
    return query.guildId
      ? this.cache.keys.forGuild(
          query.guildId,
          CacheNamespace.Generic,
          AUDIT_CACHE_PREFIX,
          'query',
          digest,
        )
      : this.cache.keys.forGlobal(
          CacheNamespace.Generic,
          AUDIT_CACHE_PREFIX,
          'query',
          digest,
        );
  }

  private describeFilters(query: AuditQuery): Record<string, unknown> {
    const { pagination: _pagination, from, to, ...rest } = query;
    return {
      ...rest,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
    };
  }

  /** Page<AuditEntry> holds bigints/Dates — serialise for the JSON cache. */
  private toCacheable(page: Page<AuditEntry>): Page<ExportedEntry> {
    return { ...page, items: page.items.map((e) => this.writer.toWire(e)) };
  }

  private fromCacheable(page: Page<ExportedEntry>): Page<AuditEntry> {
    return {
      ...page,
      items: page.items.map((e) => ({
        ...e,
        scope: e.scope as AuditScope,
        source: e.source as AuditSource,
        actorType: e.actorType as AuditActorType,
        seq: BigInt(e.seq),
        occurredAt: new Date(e.occurredAt),
        createdAt: new Date(e.createdAt),
      })),
    };
  }
}
