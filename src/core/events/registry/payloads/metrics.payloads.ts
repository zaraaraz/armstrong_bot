/**
 * Event payloads related to the Metrics module (Phase 4, item 16).
 *
 * The Metrics module derives metrics by consuming domain events off the bus
 * (never by calling other modules). Some source events already exist elsewhere
 * (`api.request.completed`, `scheduler.job.*`); the ones declared here are the
 * remaining low-level signals — command execution, gateway heartbeat/reconnect,
 * cache access and generic module activity — that emitters publish for
 * observability. Event names follow `module.entity.action`.
 *
 * The Metrics module also EMITS alerting/rollup events (`metrics.threshold.*`,
 * `metrics.snapshot.*`) consumed by notifications/dashboard via the bus.
 */

export interface CommandExecutedPayload {
  readonly module: string;
  readonly command: string;
  readonly guildId: string | null;
  readonly durationMs: number;
  readonly success: boolean;
}

export interface GatewayHeartbeatPayload {
  readonly shardId: number;
  readonly latencyMs: number;
  readonly status: 'ready' | 'reconnecting' | 'idle' | 'disconnected';
}

export interface GatewayReconnectPayload {
  readonly shardId: number;
  readonly occurredAt: string; // ISO
}

export interface DiscordRateLimitPayload {
  readonly global: boolean;
  readonly route: string;
  readonly occurredAt: string; // ISO
}

export interface CacheAccessPayload {
  readonly result: 'hit' | 'miss';
  readonly namespace: string;
}

export interface ModuleEventPayload {
  readonly module: string;
  readonly event: string;
  readonly guildId: string | null;
}

export interface MetricThresholdBreachedPayload {
  readonly metric: string;
  readonly scope:
    'system' | 'gateway' | 'api' | 'database' | 'cache' | 'queue' | 'commands';
  readonly value: number;
  readonly threshold: number;
  readonly comparator: 'gt' | 'lt' | 'gte' | 'lte';
  readonly severity: 'warning' | 'critical';
  readonly guildId: string | null;
  readonly observedAt: string; // ISO
}

export interface MetricSnapshotCreatedPayload {
  readonly snapshotId: string;
  readonly scope:
    'system' | 'gateway' | 'api' | 'database' | 'cache' | 'queue' | 'commands';
  readonly guildId: string | null;
  readonly capturedAt: string; // ISO
}

export interface MetricsEventPayloads {
  'command.executed': CommandExecutedPayload;
  'gateway.heartbeat': GatewayHeartbeatPayload;
  'gateway.reconnect': GatewayReconnectPayload;
  'discord.ratelimit': DiscordRateLimitPayload;
  'cache.access': CacheAccessPayload;
  'module.event': ModuleEventPayload;
  'metrics.threshold.breached': MetricThresholdBreachedPayload;
  'metrics.snapshot.created': MetricSnapshotCreatedPayload;
}
