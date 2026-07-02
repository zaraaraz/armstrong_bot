/**
 * Canonical metric names — the single source of truth. Never hard-code a metric
 * string anywhere else; import from here so a rename is a compile error.
 *
 * Names follow the Prometheus convention `ghost_<subsystem>_<unit>[_total]`.
 */
export enum MetricName {
  // System / process
  ProcessCpuSeconds = 'ghost_process_cpu_seconds_total',
  ProcessResidentMemoryBytes = 'ghost_process_resident_memory_bytes',
  EventLoopLagSeconds = 'ghost_event_loop_lag_seconds',
  // Gateway / Discord
  GatewayLatencySeconds = 'ghost_gateway_latency_seconds',
  GatewayShardState = 'ghost_gateway_shard_state',
  GatewayReconnectsTotal = 'ghost_gateway_reconnects_total',
  DiscordRateLimitTotal = 'ghost_discord_rate_limit_total',
  // API
  HttpRequestDurationSeconds = 'ghost_http_request_duration_seconds',
  HttpRequestsTotal = 'ghost_http_requests_total',
  // Database
  DbQueryDurationSeconds = 'ghost_db_query_duration_seconds',
  DbPoolConnections = 'ghost_db_pool_connections',
  // Cache
  CacheOpsTotal = 'ghost_cache_ops_total',
  CacheHitRatio = 'ghost_cache_hit_ratio',
  // Queue / jobs
  JobDurationSeconds = 'ghost_job_duration_seconds',
  JobsTotal = 'ghost_jobs_total',
  QueueDepth = 'ghost_queue_depth',
  QueueDlqDepth = 'ghost_queue_dlq_depth',
  // Commands / modules
  CommandDurationSeconds = 'ghost_command_duration_seconds',
  CommandsTotal = 'ghost_commands_total',
  ModuleEventsTotal = 'ghost_module_events_total',
}

/** Every metric name as a runtime array (for validation / catalog iteration). */
export const ALL_METRIC_NAMES: readonly MetricName[] =
  Object.values(MetricName);
