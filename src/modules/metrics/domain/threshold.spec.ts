import { describe, expect, it } from 'vitest';
import {
  isBreached,
  fromDbComparator,
  toDbComparator,
  fromDbSeverity,
  toDbSeverity,
  type Threshold,
} from './threshold';

const base: Omit<Threshold, 'comparator' | 'value'> = {
  metric: 'ghost_x',
  severity: 'warning',
};

describe('isBreached', () => {
  it('gt: fires only strictly above', () => {
    const t: Threshold = { ...base, comparator: 'gt', value: 10 };
    expect(isBreached(11, t)).toBe(true);
    expect(isBreached(10, t)).toBe(false);
    expect(isBreached(9, t)).toBe(false);
  });

  it('gte: fires at or above', () => {
    const t: Threshold = { ...base, comparator: 'gte', value: 10 };
    expect(isBreached(10, t)).toBe(true);
    expect(isBreached(9.99, t)).toBe(false);
  });

  it('lt: fires only strictly below', () => {
    const t: Threshold = { ...base, comparator: 'lt', value: 10 };
    expect(isBreached(9, t)).toBe(true);
    expect(isBreached(10, t)).toBe(false);
  });

  it('lte: fires at or below', () => {
    const t: Threshold = { ...base, comparator: 'lte', value: 10 };
    expect(isBreached(10, t)).toBe(true);
    expect(isBreached(10.01, t)).toBe(false);
  });
});

describe('db enum conversions', () => {
  it('round-trips comparators', () => {
    for (const c of ['gt', 'lt', 'gte', 'lte'] as const) {
      expect(fromDbComparator(toDbComparator(c))).toBe(c);
    }
    expect(toDbComparator('gt')).toBe('GT');
  });

  it('round-trips severities', () => {
    expect(toDbSeverity('critical')).toBe('CRITICAL');
    expect(fromDbSeverity('WARNING')).toBe('warning');
    expect(fromDbSeverity('anything-else')).toBe('warning');
  });

  it('rejects an unknown comparator', () => {
    expect(() => fromDbComparator('EQ')).toThrow();
  });
});
