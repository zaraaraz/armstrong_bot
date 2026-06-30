import { isValidCron, nextCronRun } from './cron.util';

describe('cron.util', () => {
  describe('isValidCron', () => {
    it('accepts a standard 5-field expression', () => {
      expect(isValidCron('0 3 * * *')).toBe(true);
    });

    it('accepts a 6-field (seconds) expression', () => {
      expect(isValidCron('*/30 * * * * *')).toBe(true);
    });

    it('rejects garbage', () => {
      expect(isValidCron('not-a-cron')).toBe(false);
      expect(isValidCron('99 99 * * *')).toBe(false);
    });
  });

  describe('nextCronRun', () => {
    it('returns the next occurrence strictly after `from`', () => {
      const from = new Date('2026-06-30T03:00:00Z');
      const next = nextCronRun('0 3 * * *', 'UTC', from);
      expect(next?.toISOString()).toBe('2026-07-01T03:00:00.000Z');
    });

    it('returns null for an invalid expression', () => {
      expect(nextCronRun('bad', 'UTC', new Date())).toBeNull();
    });
  });
});
