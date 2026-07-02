/**
 * Event payloads for the Logs module (Phase 5, item 19).
 *
 * The module CONSUMES domain events from other modules (tickets, command usage)
 * and Discord gateway events, funnels them through a single ingest pipeline, and
 * EMITS two lifecycle events reflecting the outcome of a dispatch to a Discord
 * log channel: `logs.entry.dispatched` (success) and `logs.entry.failed`
 * (permanent failure / exhausted retries). Consumed by the dashboard for live
 * status and by metrics/alerting. Event names follow `module.entity.action`.
 */

export interface LogDispatchedPayload {
  readonly guildId: string;
  /** LogCategory string value, e.g. "MESSAGE_DELETE". */
  readonly category: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly correlationId: string | null;
}

export interface LogFailedPayload {
  readonly guildId: string;
  readonly category: string;
  readonly reason: string;
  readonly correlationId: string | null;
}

export interface LogsEventPayloads {
  'logs.entry.dispatched': LogDispatchedPayload;
  'logs.entry.failed': LogFailedPayload;
}
