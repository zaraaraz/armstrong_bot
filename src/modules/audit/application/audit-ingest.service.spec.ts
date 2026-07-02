import { describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '../../../core/events/envelope/event-envelope';
import type { EventName } from '../../../core/events/registry/event-map';
import { AuditIngestService } from './audit-ingest.service';
import type { AuditEntryDraft } from '../domain/audit-entry.model';
import {
  AuditActorType,
  AuditScope,
  AuditSource,
} from '../domain/audit-scope.enum';

interface Mocks {
  enqueueDraft: ReturnType<typeof vi.fn>;
  recordIngest: ReturnType<typeof vi.fn>;
  globalConfig: {
    ingestEnabled: boolean;
    redactMetadataKeys: string[];
    denyActionPrefixes: string[];
  };
}

function build(overrides: Partial<Mocks['globalConfig']> = {}): {
  service: AuditIngestService;
  mocks: Mocks;
} {
  const globalConfig = {
    ingestEnabled: true,
    redactMetadataKeys: ['password', 'token', 'secret', 'authorization'],
    denyActionPrefixes: [
      'audit.entry.recorded',
      'system.heartbeat',
      'cache.hit',
    ],
    ...overrides,
  };
  const enqueueDraft = vi.fn().mockResolvedValue(undefined);
  const recordIngest = vi.fn();
  const config = {
    global: () => globalConfig,
    denyPrefixesFor: vi.fn().mockResolvedValue(globalConfig.denyActionPrefixes),
  };
  const queue = { enqueueDraft };
  const metrics = { recordIngest };
  const service = new AuditIngestService(
    config as never,
    queue as never,
    metrics as never,
  );
  return { service, mocks: { enqueueDraft, recordIngest, globalConfig } };
}

interface EnvelopeOverrides {
  id?: string;
  name?: string;
  payload?: unknown;
  guildId?: string | null;
  actor?: { type: string; id: string };
  occurredAt?: string;
  correlationId?: string;
  causationId?: string | null;
  meta?: Record<string, string | number | boolean>;
}

function makeEnvelope(overrides: EnvelopeOverrides = {}): EventEnvelope {
  return {
    id: 'env-1',
    name: 'tickets.ticket.closed' as EventName,
    payload: { ticketId: 't-9', reason: 'done' },
    guildId: 'g1',
    actor: { type: 'user', id: 'user-1' },
    occurredAt: '2026-07-01T10:00:00.000Z',
    correlationId: 'corr-1',
    causationId: null,
    version: 1,
    ...overrides,
  } as unknown as EventEnvelope;
}

function enqueuedDraft(mocks: Mocks): AuditEntryDraft {
  return mocks.enqueueDraft.mock.calls[0][0] as AuditEntryDraft;
}

describe('AuditIngestService.ingestEnvelope', () => {
  it('normalises an envelope into a guild-scoped draft and enqueues with the envelope id', async () => {
    const { service, mocks } = build();
    await service.ingestEnvelope(makeEnvelope());

    expect(mocks.enqueueDraft).toHaveBeenCalledOnce();
    const draft = enqueuedDraft(mocks);
    expect(draft.scope).toBe(AuditScope.Guild);
    expect(draft.guildId).toBe('g1');
    expect(draft.action).toBe('tickets.ticket.closed');
    expect(draft.source).toBe(AuditSource.Command);
    expect(draft.actorId).toBe('user-1');
    expect(draft.actorType).toBe(AuditActorType.User);
    expect(draft.targetType).toBe('ticket');
    expect(draft.targetId).toBe('t-9'); // derived from payload.ticketId
    expect(draft.correlationId).toBe('corr-1');
    expect(draft.summary).toBe('audit:actions.tickets.ticket.closed');
    expect(draft.metadata['envelopeId']).toBe('env-1');
    expect(draft.occurredAt.toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(mocks.enqueueDraft.mock.calls[0][1]).toBe('env-1');
  });

  it('maps GLOBAL scope, sources and actor types from the envelope actor', async () => {
    const { service, mocks } = build();
    await service.ingestEnvelope(
      makeEnvelope({
        guildId: null,
        actor: { type: 'job', id: 'scheduler' },
        name: 'scheduler.job.completed',
        payload: { jobId: 'j-1' },
      }),
    );
    const draft = enqueuedDraft(mocks);
    expect(draft.scope).toBe(AuditScope.Global);
    expect(draft.guildId).toBeNull();
    expect(draft.source).toBe(AuditSource.Job);
    expect(draft.actorType).toBe(AuditActorType.System);
    expect(draft.actorId).toBe('scheduler');
  });

  it('maps user actors on dashboard.* events to the DASHBOARD source', async () => {
    const { service, mocks } = build();
    await service.ingestEnvelope(
      makeEnvelope({ name: 'dashboard.config.updated' }),
    );
    expect(enqueuedDraft(mocks).source).toBe(AuditSource.Dashboard);
  });

  it('nullifies actorId for system actors and marks discord actors as BOT/EVENT', async () => {
    const { service, mocks } = build();
    await service.ingestEnvelope(
      makeEnvelope({ actor: { type: 'system', id: 'core' } }),
    );
    expect(enqueuedDraft(mocks).actorId).toBeNull();
    expect(enqueuedDraft(mocks).source).toBe(AuditSource.System);

    mocks.enqueueDraft.mockClear();
    await service.ingestEnvelope(
      makeEnvelope({ actor: { type: 'discord', id: 'bot-1' } }),
    );
    expect(enqueuedDraft(mocks).actorType).toBe(AuditActorType.Bot);
    expect(enqueuedDraft(mocks).source).toBe(AuditSource.Event);
  });

  it('lifts payload before/after into diff fields and keeps the rest as metadata', async () => {
    const { service, mocks } = build();
    await service.ingestEnvelope(
      makeEnvelope({
        payload: {
          before: { locale: 'en' },
          after: { locale: 'pt' },
          configKey: 'locale',
        },
      }),
    );
    const draft = enqueuedDraft(mocks);
    expect(draft.before).toEqual({ locale: 'en' });
    expect(draft.after).toEqual({ locale: 'pt' });
    expect(draft.metadata['configKey']).toBe('locale');
    expect(draft.metadata['before']).toBeUndefined();
  });

  it('redacts sensitive keys case-insensitively and deeply', async () => {
    const { service, mocks } = build();
    await service.ingestEnvelope(
      makeEnvelope({
        payload: {
          Token: 'abc',
          nested: { credentials: { PASSWORD: 'hunter2' }, ok: 1 },
          list: [{ secret: 's' }],
        },
      }),
    );
    const meta = enqueuedDraft(mocks).metadata as Record<string, unknown>;
    expect(meta['Token']).toBe('[REDACTED]');
    const nested = meta['nested'] as {
      credentials: Record<string, unknown>;
      ok: number;
    };
    expect(nested.credentials['PASSWORD']).toBe('[REDACTED]');
    expect(nested.ok).toBe(1);
    expect((meta['list'] as Array<Record<string, unknown>>)[0]['secret']).toBe(
      '[REDACTED]',
    );
  });

  it('never records audit.entry.recorded (recursion guard), even if config omits it', async () => {
    const { service, mocks } = build({ denyActionPrefixes: [] });
    await service.ingestEnvelope(
      makeEnvelope({ name: 'audit.entry.recorded' }),
    );
    expect(mocks.enqueueDraft).not.toHaveBeenCalled();
    expect(mocks.recordIngest).toHaveBeenCalledWith('skipped');
  });

  it('skips deny-listed prefixes from config', async () => {
    const { service, mocks } = build();
    await service.ingestEnvelope(
      makeEnvelope({ name: 'system.heartbeat.tick' }),
    );
    expect(mocks.enqueueDraft).not.toHaveBeenCalled();
    expect(mocks.recordIngest).toHaveBeenCalledWith('skipped');
  });

  it('does nothing when ingest is disabled', async () => {
    const { service, mocks } = build({ ingestEnabled: false });
    await service.ingestEnvelope(makeEnvelope());
    expect(mocks.enqueueDraft).not.toHaveBeenCalled();
  });

  it('degrades gracefully: enqueue failures are swallowed and counted as dropped', async () => {
    const { service, mocks } = build();
    mocks.enqueueDraft.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      service.ingestEnvelope(makeEnvelope()),
    ).resolves.toBeUndefined();
    expect(mocks.recordIngest).toHaveBeenCalledWith('dropped');
  });
});

describe('AuditIngestService.record', () => {
  const validDraft: AuditEntryDraft = {
    scope: AuditScope.Guild,
    guildId: 'g1',
    action: 'audit.export.performed',
    source: AuditSource.Api,
    actorId: 'user-1',
    actorType: AuditActorType.User,
    targetType: 'ledger',
    targetId: 'g1',
    channelId: null,
    correlationId: 'corr-x',
    causationId: null,
    summary: 'audit:actions.audit.export.performed',
    metadata: { format: 'ndjson', token: 'leak-me' },
    before: null,
    after: null,
    occurredAt: new Date('2026-07-01T10:00:00Z'),
  };

  it('redacts and enqueues a valid draft', async () => {
    const { service, mocks } = build();
    await service.record(validDraft);
    expect(mocks.enqueueDraft).toHaveBeenCalledOnce();
    expect(enqueuedDraft(mocks).metadata['token']).toBe('[REDACTED]');
  });

  it('rejects GLOBAL drafts carrying a guildId and GUILD drafts without one', async () => {
    const { service } = build();
    await expect(
      service.record({ ...validDraft, scope: AuditScope.Global }),
    ).rejects.toThrow(/GLOBAL/);
    await expect(
      service.record({ ...validDraft, guildId: null }),
    ).rejects.toThrow(/require a guildId/);
  });

  it('rejects drafts without action or correlationId', async () => {
    const { service } = build();
    await expect(service.record({ ...validDraft, action: '' })).rejects.toThrow(
      /action and correlationId/,
    );
  });
});
