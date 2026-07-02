import { describe, expect, it } from 'vitest';
import {
  METRIC_CATALOG,
  FORBIDDEN_LABEL_KEYS,
  assertCatalogComplete,
  assertNoForbiddenLabels,
} from './metric-definition';
import { MetricName, ALL_METRIC_NAMES } from './metric-name.enum';

describe('metric catalog', () => {
  it('has exactly one entry per MetricName', () => {
    expect(() => assertCatalogComplete()).not.toThrow();
    expect(Object.keys(METRIC_CATALOG)).toHaveLength(ALL_METRIC_NAMES.length);
  });

  it('every entry key matches its definition name', () => {
    for (const name of ALL_METRIC_NAMES) {
      expect(METRIC_CATALOG[name].name).toBe(name);
    }
  });

  it('carries no forbidden / high-cardinality label keys', () => {
    expect(() => assertNoForbiddenLabels()).not.toThrow();
    for (const def of Object.values(METRIC_CATALOG)) {
      for (const label of def.labelNames) {
        expect(FORBIDDEN_LABEL_KEYS.has(label.toLowerCase())).toBe(false);
      }
    }
  });

  it('assigns a known scope to every metric', () => {
    const scopes = new Set([
      'system',
      'gateway',
      'api',
      'database',
      'cache',
      'queue',
      'commands',
    ]);
    for (const def of Object.values(METRIC_CATALOG)) {
      expect(scopes.has(def.scope)).toBe(true);
    }
  });

  it('names counters with a _total suffix', () => {
    for (const def of Object.values(METRIC_CATALOG)) {
      if (def.type === 'counter') {
        expect(def.name.endsWith('_total')).toBe(true);
      }
    }
  });

  it('assertNoForbiddenLabels fails if a forbidden label is introduced', () => {
    const mutable = METRIC_CATALOG[MetricName.CommandsTotal] as unknown as {
      labelNames: string[];
    };
    const original = [...mutable.labelNames];
    mutable.labelNames = [...original, 'user_id'];
    try {
      expect(() => assertNoForbiddenLabels()).toThrow(/forbidden label/);
    } finally {
      mutable.labelNames = original;
    }
  });
});
