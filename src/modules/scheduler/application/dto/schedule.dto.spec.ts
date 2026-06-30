import { scheduleOnceSchema } from './schedule-once.dto';
import { scheduleRecurringSchema } from './schedule-recurring.dto';

describe('scheduleOnceSchema', () => {
  it('accepts a runAt-only input', () => {
    const out = scheduleOnceSchema.parse({
      guildId: 'g1',
      kind: 'reminder',
      payload: { text: 'hi' },
      runAt: '2026-06-30T10:00:00Z',
    });
    expect(out.deferrableInMaintenance).toBe(true); // default applied
    expect(out.runAt).toBeInstanceOf(Date);
  });

  it('accepts a delayMs-only input', () => {
    expect(() =>
      scheduleOnceSchema.parse({
        guildId: null,
        kind: 'cleanup',
        payload: {},
        delayMs: 5000,
      }),
    ).not.toThrow();
  });

  it('rejects supplying both runAt and delayMs', () => {
    expect(() =>
      scheduleOnceSchema.parse({
        guildId: 'g1',
        kind: 'k',
        payload: {},
        runAt: '2026-06-30T10:00:00Z',
        delayMs: 1000,
      }),
    ).toThrow();
  });

  it('rejects supplying neither runAt nor delayMs', () => {
    expect(() =>
      scheduleOnceSchema.parse({ guildId: 'g1', kind: 'k', payload: {} }),
    ).toThrow();
  });
});

describe('scheduleRecurringSchema', () => {
  it('accepts a valid cron with required idempotencyKey', () => {
    const out = scheduleRecurringSchema.parse({
      guildId: null,
      kind: 'backup',
      payload: {},
      cron: '0 3 * * *',
      idempotencyKey: 'nightly',
    });
    expect(out.cron).toBe('0 3 * * *');
  });

  it('rejects an invalid cron expression', () => {
    expect(() =>
      scheduleRecurringSchema.parse({
        guildId: null,
        kind: 'backup',
        payload: {},
        cron: 'every-night-please',
        idempotencyKey: 'nightly',
      }),
    ).toThrow();
  });

  it('rejects both cron and everyMs', () => {
    expect(() =>
      scheduleRecurringSchema.parse({
        guildId: null,
        kind: 'k',
        payload: {},
        cron: '0 3 * * *',
        everyMs: 60000,
        idempotencyKey: 'x',
      }),
    ).toThrow();
  });

  it('requires an idempotencyKey', () => {
    expect(() =>
      scheduleRecurringSchema.parse({
        guildId: null,
        kind: 'k',
        payload: {},
        everyMs: 60000,
      }),
    ).toThrow();
  });
});
