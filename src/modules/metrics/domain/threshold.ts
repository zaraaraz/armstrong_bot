import type { MetricScope } from './metric-scope';

export type ThresholdComparator = 'gt' | 'lt' | 'gte' | 'lte';
export type ThresholdSeverity = 'warning' | 'critical';

/**
 * An alerting rule: when `metric`'s observed value satisfies `comparator`
 * against `value`, a breach of `severity` fires. Immutable value object.
 */
export interface Threshold {
  readonly metric: string;
  readonly comparator: ThresholdComparator;
  readonly value: number;
  readonly severity: ThresholdSeverity;
  /** true for a guild override, false/undefined for a global default. */
  readonly guildScoped?: boolean;
}

/** An effective, resolved threshold (defaults layered under guild overrides). */
export interface EffectiveThreshold extends Threshold {
  readonly source: 'default' | 'override';
}

/** Pure comparison — does `observed` breach `threshold`? */
export function isBreached(observed: number, threshold: Threshold): boolean {
  switch (threshold.comparator) {
    case 'gt':
      return observed > threshold.value;
    case 'lt':
      return observed < threshold.value;
    case 'gte':
      return observed >= threshold.value;
    case 'lte':
      return observed <= threshold.value;
    default: {
      const exhaustive: never = threshold.comparator;
      return exhaustive;
    }
  }
}

/** DB comparator literal (UPPERCASE) -> wire comparator. */
export function fromDbComparator(value: string): ThresholdComparator {
  const lower = value.toLowerCase();
  if (lower === 'gt' || lower === 'lt' || lower === 'gte' || lower === 'lte') {
    return lower;
  }
  throw new Error(`unknown comparator: ${value}`);
}

/** Wire comparator -> DB comparator literal (UPPERCASE). */
export function toDbComparator(value: ThresholdComparator): string {
  return value.toUpperCase();
}

export function fromDbSeverity(value: string): ThresholdSeverity {
  return value.toLowerCase() === 'critical' ? 'critical' : 'warning';
}

export function toDbSeverity(value: ThresholdSeverity): string {
  return value.toUpperCase();
}

/**
 * Which dashboard scope a metric string belongs to. Used to stamp the scope on
 * a breach event when a threshold names a metric by its raw string. Falls back
 * to 'system' for unknown/custom metrics.
 */
export function scopeForMetric(
  metric: string,
  lookup: (metric: string) => MetricScope | undefined,
): MetricScope {
  return lookup(metric) ?? 'system';
}
