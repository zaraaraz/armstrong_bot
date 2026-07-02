import { MetricName } from './metric-name.enum';
import type { MetricScope } from './metric-scope';

/** prom-client instrument kind for a metric definition. */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/**
 * Value-object describing one metric: its prom-client type, help text, the
 * fixed label keys it carries, and the dashboard scope it rolls up into.
 *
 * Label keys are a CLOSED set per metric — the registry rejects any label key
 * not declared here, which is how we structurally guarantee no unbounded /
 * high-cardinality labels ever reach Prometheus.
 */
export interface MetricDefinition {
  readonly name: MetricName;
  readonly type: MetricType;
  readonly help: string;
  readonly labelNames: readonly string[];
  readonly scope: MetricScope;
  /** Histogram-only: bucket bounds. Omitted => use the configured default set. */
  readonly buckets?: readonly number[];
}

/**
 * The full catalog. Every {@link MetricName} MUST have exactly one entry —
 * enforced by {@link assertCatalogComplete} at module init.
 *
 * Label discipline: labels are strictly low-cardinality (module, command,
 * scope, result, method, route TEMPLATE, status class, shard, state, queue).
 * There are deliberately NO user-id, guild-id-per-series, path (raw), or
 * free-text labels — those would explode cardinality or leak PII.
 */
export const METRIC_CATALOG: Readonly<Record<MetricName, MetricDefinition>> = {
  // ── System / process ──────────────────────────────────────────────────────
  [MetricName.ProcessCpuSeconds]: {
    name: MetricName.ProcessCpuSeconds,
    type: 'counter',
    help: 'Total user + system CPU time spent, in seconds.',
    labelNames: [],
    scope: 'system',
  },
  [MetricName.ProcessResidentMemoryBytes]: {
    name: MetricName.ProcessResidentMemoryBytes,
    type: 'gauge',
    help: 'Resident memory size in bytes.',
    labelNames: [],
    scope: 'system',
  },
  [MetricName.EventLoopLagSeconds]: {
    name: MetricName.EventLoopLagSeconds,
    type: 'gauge',
    help: 'Event-loop lag in seconds (mean over the collection interval).',
    labelNames: [],
    scope: 'system',
  },
  // ── Gateway / Discord ─────────────────────────────────────────────────────
  [MetricName.GatewayLatencySeconds]: {
    name: MetricName.GatewayLatencySeconds,
    type: 'histogram',
    help: 'Discord gateway heartbeat round-trip latency in seconds.',
    labelNames: ['shard'],
    scope: 'gateway',
  },
  [MetricName.GatewayShardState]: {
    name: MetricName.GatewayShardState,
    type: 'gauge',
    help: 'Current shard state (0=disconnected,1=idle,2=reconnecting,3=ready).',
    labelNames: ['shard'],
    scope: 'gateway',
  },
  [MetricName.GatewayReconnectsTotal]: {
    name: MetricName.GatewayReconnectsTotal,
    type: 'counter',
    help: 'Total gateway reconnects.',
    labelNames: ['shard'],
    scope: 'gateway',
  },
  [MetricName.DiscordRateLimitTotal]: {
    name: MetricName.DiscordRateLimitTotal,
    type: 'counter',
    help: 'Total Discord REST rate-limit hits.',
    labelNames: ['global'],
    scope: 'gateway',
  },
  // ── API ───────────────────────────────────────────────────────────────────
  [MetricName.HttpRequestDurationSeconds]: {
    name: MetricName.HttpRequestDurationSeconds,
    type: 'histogram',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status_class'],
    scope: 'api',
  },
  [MetricName.HttpRequestsTotal]: {
    name: MetricName.HttpRequestsTotal,
    type: 'counter',
    help: 'Total HTTP requests by method, route template and status class.',
    labelNames: ['method', 'route', 'status_class'],
    scope: 'api',
  },
  // ── Database ──────────────────────────────────────────────────────────────
  [MetricName.DbQueryDurationSeconds]: {
    name: MetricName.DbQueryDurationSeconds,
    type: 'histogram',
    help: 'Prisma query duration in seconds by model and action.',
    labelNames: ['model', 'action'],
    scope: 'database',
  },
  [MetricName.DbPoolConnections]: {
    name: MetricName.DbPoolConnections,
    type: 'gauge',
    help: 'Database connection-pool gauge by state (active, idle).',
    labelNames: ['state'],
    scope: 'database',
  },
  // ── Cache ─────────────────────────────────────────────────────────────────
  [MetricName.CacheOpsTotal]: {
    name: MetricName.CacheOpsTotal,
    type: 'counter',
    help: 'Total cache operations by result (hit, miss).',
    labelNames: ['result'],
    scope: 'cache',
  },
  [MetricName.CacheHitRatio]: {
    name: MetricName.CacheHitRatio,
    type: 'gauge',
    help: 'Rolling cache hit ratio (0..1).',
    labelNames: [],
    scope: 'cache',
  },
  // ── Queue / jobs ──────────────────────────────────────────────────────────
  [MetricName.JobDurationSeconds]: {
    name: MetricName.JobDurationSeconds,
    type: 'histogram',
    help: 'Background job duration in seconds by queue.',
    labelNames: ['queue', 'state'],
    scope: 'queue',
  },
  [MetricName.JobsTotal]: {
    name: MetricName.JobsTotal,
    type: 'counter',
    help: 'Total jobs by queue and terminal state.',
    labelNames: ['queue', 'state'],
    scope: 'queue',
  },
  [MetricName.QueueDepth]: {
    name: MetricName.QueueDepth,
    type: 'gauge',
    help: 'Waiting + delayed jobs by queue.',
    labelNames: ['queue'],
    scope: 'queue',
  },
  [MetricName.QueueDlqDepth]: {
    name: MetricName.QueueDlqDepth,
    type: 'gauge',
    help: 'Dead-letter (failed) jobs by queue.',
    labelNames: ['queue'],
    scope: 'queue',
  },
  // ── Commands / modules ────────────────────────────────────────────────────
  [MetricName.CommandDurationSeconds]: {
    name: MetricName.CommandDurationSeconds,
    type: 'histogram',
    help: 'Slash-command execution duration in seconds.',
    labelNames: ['module', 'command', 'status'],
    scope: 'commands',
  },
  [MetricName.CommandsTotal]: {
    name: MetricName.CommandsTotal,
    type: 'counter',
    help: 'Total slash-command invocations by module, command and status.',
    labelNames: ['module', 'command', 'status'],
    scope: 'commands',
  },
  [MetricName.ModuleEventsTotal]: {
    name: MetricName.ModuleEventsTotal,
    type: 'counter',
    help: 'Total domain events observed on the bus by module.',
    labelNames: ['module'],
    scope: 'commands',
  },
};

/**
 * Label keys we forbid on ANY metric because they are unbounded or PII.
 * The registry cross-checks catalog label keys against this set at init so a
 * bad definition fails fast rather than silently exploding cardinality.
 */
export const FORBIDDEN_LABEL_KEYS: ReadonlySet<string> = new Set([
  'user',
  'userid',
  'user_id',
  'guild',
  'guildid',
  'guild_id',
  'path',
  'url',
  'content',
  'message',
  'ip',
  'email',
  'id',
]);

/** Fails fast if a MetricName has no catalog entry (keeps the two in lockstep). */
export function assertCatalogComplete(): void {
  for (const name of Object.values(MetricName)) {
    if (!METRIC_CATALOG[name]) {
      throw new Error(`metric ${name} is missing from METRIC_CATALOG`);
    }
  }
}

/** Fails fast if any catalog metric declares a forbidden (high-cardinality) label. */
export function assertNoForbiddenLabels(): void {
  for (const def of Object.values(METRIC_CATALOG)) {
    for (const label of def.labelNames) {
      if (FORBIDDEN_LABEL_KEYS.has(label.toLowerCase())) {
        throw new Error(
          `metric ${def.name} declares forbidden label "${label}"`,
        );
      }
    }
  }
}
