import type { JobKind } from './job-kind.enum';

/**
 * Context handed to a {@link JobHandler} for a single execution attempt.
 * Everything a handler needs to act idempotently and observably.
 */
export interface JobExecutionContext {
  readonly jobId: string;
  readonly jobKind: JobKind | string;
  readonly guildId: string | null; // null => global/system job
  readonly attempt: number;
  readonly scheduledFor: Date;
  readonly traceId: string;
}

/**
 * A module-supplied executor for one {@link JobKind}. Registered at bootstrap via
 * {@link JobRegistry}. The Scheduler resolves and invokes it inside a trace span.
 *
 * Handlers MUST be idempotent for the same `(jobId, idempotencyKey)` because
 * execution is at-least-once.
 */
export interface JobHandler<TPayload = unknown> {
  readonly kind: JobKind | string;
  /** Validate the raw persisted payload (Zod) and return a typed payload. */
  parse(raw: unknown): TPayload;
  /** Execute the work. Throwing triggers the retry/backoff/DLQ policy. */
  handle(payload: TPayload, ctx: JobExecutionContext): Promise<void>;
}
