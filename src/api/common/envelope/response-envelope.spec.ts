import {
  isEnvelope,
  isPaginatedEnvelope,
  type PaginatedEnvelope,
  type SuccessEnvelope,
} from './response-envelope';

const meta = { requestId: 'r', timestamp: 't', version: 'v1' as const };

describe('envelope type guards', () => {
  it('detects a success envelope', () => {
    const env: SuccessEnvelope<number> = { success: true, data: 1, meta };
    expect(isEnvelope(env)).toBe(true);
    expect(isPaginatedEnvelope(env)).toBe(false);
  });

  it('detects a paginated envelope', () => {
    const env: PaginatedEnvelope<number> = {
      success: true,
      data: [1],
      pagination: {
        limit: 25,
        total: 1,
        nextCursor: null,
        prevCursor: null,
        hasMore: false,
      },
      meta,
    };
    expect(isPaginatedEnvelope(env)).toBe(true);
  });

  it('rejects non-envelopes', () => {
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope({ success: false })).toBe(false);
    expect(isEnvelope({ data: 1 })).toBe(false);
    expect(isEnvelope('string')).toBe(false);
  });
});
