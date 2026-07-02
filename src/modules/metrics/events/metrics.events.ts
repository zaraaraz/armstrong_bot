/** Namespaced event names emitted by the Metrics module on the core Event Bus. */
export const MetricsEvents = {
  ThresholdBreached: 'metrics.threshold.breached',
  SnapshotCreated: 'metrics.snapshot.created',
} as const;

export type MetricsEventName =
  (typeof MetricsEvents)[keyof typeof MetricsEvents];

/**
 * Source events the module CONSUMES to derive metrics. Some pre-exist in other
 * units (api.request.completed, scheduler.job.*); the rest are declared in
 * `core/events/registry/payloads/metrics.payloads.ts`.
 */
export const ConsumedEvents = {
  CommandExecuted: 'command.executed',
  GatewayHeartbeat: 'gateway.heartbeat',
  GatewayReconnect: 'gateway.reconnect',
  DiscordRateLimit: 'discord.ratelimit',
  CacheAccess: 'cache.access',
  ModuleEvent: 'module.event',
  ApiRequestCompleted: 'api.request.completed',
  SchedulerJobCompleted: 'scheduler.job.completed',
  SchedulerJobFailed: 'scheduler.job.failed',
  SchedulerJobDeadLettered: 'scheduler.job.dead_lettered',
} as const;
