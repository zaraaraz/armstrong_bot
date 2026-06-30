/**
 * Uniform response envelopes. Every successful API handler returns either a
 * {@link SuccessEnvelope} (single resource) or a {@link PaginatedEnvelope}
 * (list). The {@link EnvelopeInterceptor} wraps bare handler returns; handlers
 * that already build a paginated envelope are passed through unchanged.
 */

export interface ResponseMeta {
  readonly requestId: string;
  readonly timestamp: string; // ISO-8601
  readonly version: 'v1';
}

export interface PaginationMeta {
  readonly limit: number;
  readonly total: number | null; // null when count is skipped for perf
  readonly nextCursor: string | null;
  readonly prevCursor: string | null;
  readonly hasMore: boolean;
}

export interface SuccessEnvelope<T> {
  readonly success: true;
  readonly data: T;
  readonly meta: ResponseMeta;
}

export interface PaginatedEnvelope<T> {
  readonly success: true;
  readonly data: ReadonlyArray<T>;
  readonly pagination: PaginationMeta;
  readonly meta: ResponseMeta;
}

/** Discriminator the EnvelopeInterceptor uses to detect a pre-built envelope. */
export function isEnvelope(value: unknown): value is SuccessEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success?: unknown }).success === true
  );
}

export function isPaginatedEnvelope(
  value: unknown,
): value is PaginatedEnvelope<unknown> {
  return isEnvelope(value) && 'pagination' in value;
}
