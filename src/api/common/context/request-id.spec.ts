import type { Request } from 'express';
import { getApiContext, getRequestId, REQUEST_ID_HEADER } from './request-id';

/** Minimal Express-like request stub for the correlation-id helpers. */
function makeReq(headers: Record<string, unknown> = {}): Request {
  return { headers } as unknown as Request;
}

describe('request-id', () => {
  describe('getRequestId', () => {
    it('honours a non-empty inbound X-Request-Id header', () => {
      const req = makeReq({ [REQUEST_ID_HEADER]: 'inbound-123' });
      expect(getRequestId(req)).toBe('inbound-123');
    });

    it('allocates a UUID when the header is absent', () => {
      const req = makeReq();
      const id = getRequestId(req);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('allocates a UUID when the header is an empty string', () => {
      const req = makeReq({ [REQUEST_ID_HEADER]: '' });
      expect(getRequestId(req)).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('ignores a non-string (array) header and allocates a UUID', () => {
      const req = makeReq({ [REQUEST_ID_HEADER]: ['a', 'b'] });
      expect(getRequestId(req)).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns the already-attached id on subsequent calls', () => {
      const req = makeReq();
      const first = getRequestId(req);
      expect(getRequestId(req)).toBe(first);
    });

    it('preserves an existing apiContext when attaching the id', () => {
      const req = makeReq() as Request & {
        apiContext?: { requestId?: string; actor?: unknown };
      };
      req.apiContext = { actor: { id: 'u1' } };
      getRequestId(req);
      expect(req.apiContext.actor).toEqual({ id: 'u1' });
      expect(req.apiContext.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('getApiContext', () => {
    it('creates a context with a request id when none exists', () => {
      const req = makeReq();
      const ctx = getApiContext(req);
      expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns the existing context when already present', () => {
      const req = makeReq();
      const first = getApiContext(req);
      expect(getApiContext(req)).toBe(first);
    });
  });
});
