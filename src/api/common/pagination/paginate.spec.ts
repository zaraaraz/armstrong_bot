import { buildPaginatedEnvelope, decodeCursor, encodeCursor } from './paginate';
import type { ResponseMeta } from '../envelope/response-envelope';

const meta: ResponseMeta = {
  requestId: 'r1',
  timestamp: '2026-06-30T00:00:00.000Z',
  version: 'v1',
};

describe('cursor encoding', () => {
  it('round-trips a string cursor', () => {
    expect(decodeCursor(encodeCursor('abc'))).toBe('abc');
  });

  it('round-trips a Date as ISO', () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    expect(decodeCursor(encodeCursor(d))).toBe('2026-01-02T03:04:05.000Z');
  });
});

describe('buildPaginatedEnvelope', () => {
  it('assembles the standard paginated shape', () => {
    const env = buildPaginatedEnvelope(
      {
        items: [1, 2],
        hasMore: true,
        total: 10,
        nextCursor: 'n',
        prevCursor: null,
      },
      { limit: 2, sort: '-createdAt' },
      meta,
    );
    expect(env.success).toBe(true);
    expect(env.data).toEqual([1, 2]);
    expect(env.pagination).toEqual({
      limit: 2,
      total: 10,
      nextCursor: 'n',
      prevCursor: null,
      hasMore: true,
    });
    expect(env.meta).toBe(meta);
  });

  it('defaults missing totals/cursors to null', () => {
    const env = buildPaginatedEnvelope(
      { items: [], hasMore: false },
      { limit: 25, sort: '-createdAt' },
      meta,
    );
    expect(env.pagination.total).toBeNull();
    expect(env.pagination.nextCursor).toBeNull();
  });
});
