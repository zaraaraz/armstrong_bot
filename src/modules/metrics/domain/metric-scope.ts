/**
 * Public scope discriminator used by snapshots and the admin API. Lowercase on
 * the wire (stable public contract); the Prisma `MetricScope` enum stores the
 * UPPERCASE form. Use {@link toDbScope}/{@link fromDbScope} at the repository
 * boundary — never leak the DB casing outside infrastructure.
 */
export type MetricScope =
  'system' | 'gateway' | 'api' | 'database' | 'cache' | 'queue' | 'commands';

export const METRIC_SCOPES: readonly MetricScope[] = [
  'system',
  'gateway',
  'api',
  'database',
  'cache',
  'queue',
  'commands',
];

export function isMetricScope(value: string): value is MetricScope {
  return (METRIC_SCOPES as readonly string[]).includes(value);
}

/** Wire scope (lowercase) -> Prisma enum literal (UPPERCASE). */
export function toDbScope(scope: MetricScope): string {
  return scope.toUpperCase();
}

/** Prisma enum literal (UPPERCASE) -> wire scope (lowercase). */
export function fromDbScope(value: string): MetricScope {
  const lower = value.toLowerCase();
  if (!isMetricScope(lower)) {
    throw new Error(`unknown metric scope: ${value}`);
  }
  return lower;
}
