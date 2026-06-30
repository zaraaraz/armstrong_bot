import { SchedulerDomainService } from './scheduler.domain-service';
import { resolveSchedulerGlobalConfig } from '../config/scheduler.config';
import type { SchedulerGuildConfig } from '../config/scheduler.config';

const global = resolveSchedulerGlobalConfig({});

function svc(): SchedulerDomainService {
  return new SchedulerDomainService();
}

describe('SchedulerDomainService', () => {
  describe('computeNextRun', () => {
    it('adds everyMs for interval jobs', () => {
      const from = new Date('2026-06-30T00:00:00Z');
      const next = svc().computeNextRun({
        everyMs: 60_000,
        timezone: 'UTC',
        from,
      });
      expect(next?.toISOString()).toBe('2026-06-30T00:01:00.000Z');
    });

    it('computes the next cron occurrence in the given timezone', () => {
      const from = new Date('2026-06-30T00:00:00Z');
      const next = svc().computeNextRun({
        cron: '0 3 * * *',
        timezone: 'UTC',
        from,
      });
      expect(next?.toISOString()).toBe('2026-06-30T03:00:00.000Z');
    });

    it('honours timezone offsets for cron', () => {
      const from = new Date('2026-06-30T00:00:00Z');
      // 03:00 in Lisbon (UTC+1 in summer) == 02:00 UTC.
      const next = svc().computeNextRun({
        cron: '0 3 * * *',
        timezone: 'Europe/Lisbon',
        from,
      });
      expect(next?.toISOString()).toBe('2026-06-30T02:00:00.000Z');
    });

    it('returns null when neither cron nor everyMs is supplied', () => {
      const next = svc().computeNextRun({
        timezone: 'UTC',
        from: new Date(),
      });
      expect(next).toBeNull();
    });
  });

  describe('deriveIdempotencyKey', () => {
    it('namespaces an explicit key by guild and kind', () => {
      const key = svc().deriveIdempotencyKey({
        guildId: 'g1',
        kind: 'reminder',
        idempotencyKey: 'abc',
      });
      expect(key).toBe('g1:reminder:abc');
    });

    it('uses "global" for null guild', () => {
      const key = svc().deriveIdempotencyKey({
        guildId: null,
        kind: 'backup',
        idempotencyKey: 'nightly',
      });
      expect(key).toBe('global:backup:nightly');
    });

    it('derives a stable hash when no explicit key', () => {
      const d = svc();
      const runAt = new Date('2026-06-30T10:00:00Z');
      const a = d.deriveIdempotencyKey({ guildId: 'g1', kind: 'k', runAt });
      const b = d.deriveIdempotencyKey({ guildId: 'g1', kind: 'k', runAt });
      expect(a).toBe(b);
      expect(a).toHaveLength(32);
    });
  });

  describe('retryPolicy', () => {
    it('falls back to global defaults', () => {
      const p = svc().retryPolicy(global);
      expect(p.attempts).toBe(5);
      expect(p.backoff).toEqual({ type: 'exponential', delay: 5000 });
    });

    it('respects a per-job maxAttempts override', () => {
      const p = svc().retryPolicy(global, 2);
      expect(p.attempts).toBe(2);
    });
  });

  describe('resolveAgainstMaintenance', () => {
    const guildConfig = (
      windows: SchedulerGuildConfig['maintenanceWindows'],
    ): SchedulerGuildConfig => ({
      timezone: 'UTC',
      maintenanceWindows: windows,
      cleanupEnabled: true,
    });

    it('does not defer a non-deferrable job', () => {
      const runAt = new Date('2026-06-30T03:10:00Z');
      const out = svc().resolveAgainstMaintenance({
        runAt,
        deferrable: false,
        guildConfig: guildConfig([
          { cron: '0 3 * * *', durationMinutes: 60, deferNonCritical: true },
        ]),
      });
      expect(out.deferred).toBe(false);
      expect(out.runAt).toBe(runAt);
    });

    it('pushes a deferrable job inside a window to the window end', () => {
      const runAt = new Date('2026-06-30T03:10:00Z'); // inside 03:00–04:00
      const out = svc().resolveAgainstMaintenance({
        runAt,
        deferrable: true,
        guildConfig: guildConfig([
          { cron: '0 3 * * *', durationMinutes: 60, deferNonCritical: true },
        ]),
      });
      expect(out.deferred).toBe(true);
      expect(out.runAt.toISOString()).toBe('2026-06-30T04:00:00.000Z');
    });

    it('leaves a job outside any window untouched', () => {
      const runAt = new Date('2026-06-30T05:00:00Z');
      const out = svc().resolveAgainstMaintenance({
        runAt,
        deferrable: true,
        guildConfig: guildConfig([
          { cron: '0 3 * * *', durationMinutes: 60, deferNonCritical: true },
        ]),
      });
      expect(out.deferred).toBe(false);
      expect(out.runAt).toBe(runAt);
    });

    it('ignores windows flagged deferNonCritical=false', () => {
      const runAt = new Date('2026-06-30T03:10:00Z');
      const out = svc().resolveAgainstMaintenance({
        runAt,
        deferrable: true,
        guildConfig: guildConfig([
          { cron: '0 3 * * *', durationMinutes: 60, deferNonCritical: false },
        ]),
      });
      expect(out.deferred).toBe(false);
    });
  });

  describe('retentionCutoff', () => {
    it('subtracts runRetentionDays from now', () => {
      const now = new Date('2026-06-30T00:00:00Z');
      const cutoff = svc().retentionCutoff(global, now); // default 30 days
      expect(cutoff.toISOString()).toBe('2026-05-31T00:00:00.000Z');
    });
  });
});
