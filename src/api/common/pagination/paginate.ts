import type {
  PaginatedEnvelope,
  PaginationMeta,
  ResponseMeta,
} from '../envelope/response-envelope';
import type { PageQuery } from './page-query.dto';

/** Encodes an opaque cursor from a record's sort key value. */
export function encodeCursor(value: string | number | Date): string {
  const raw = value instanceof Date ? value.toISOString() : String(value);
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8');
}

export interface PageResult<T> {
  /** Up to `limit` items (the loader should fetch `limit + 1` to detect more). */
  readonly items: ReadonlyArray<T>;
  readonly hasMore: boolean;
  readonly total?: number | null;
  readonly nextCursor?: string | null;
  readonly prevCursor?: string | null;
}

/**
 * Assembles a {@link PaginatedEnvelope} from a slice of loaded data and the
 * originating query. Centralizes the envelope shape so every list endpoint is
 * uniform.
 */
export function buildPaginatedEnvelope<T>(
  result: PageResult<T>,
  query: PageQuery,
  meta: ResponseMeta,
): PaginatedEnvelope<T> {
  const pagination: PaginationMeta = {
    limit: query.limit,
    total: result.total ?? null,
    nextCursor: result.nextCursor ?? null,
    prevCursor: result.prevCursor ?? null,
    hasMore: result.hasMore,
  };
  return { success: true, data: result.items, pagination, meta };
}
