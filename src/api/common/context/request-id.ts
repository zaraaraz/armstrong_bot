import { randomUUID } from 'crypto';
import type { Request } from 'express';
import type { ApiRequestContext } from './api-actor';

export const REQUEST_ID_HEADER = 'x-request-id';

type ContextualRequest = Request & { apiContext?: ApiRequestContext };

/**
 * Returns the correlation id for a request, allocating and attaching one on
 * first access. Honours an inbound `X-Request-Id` header so a correlation id
 * can flow across service boundaries.
 */
export function getRequestId(req: Request): string {
  const r = req as ContextualRequest;
  if (r.apiContext?.requestId) return r.apiContext.requestId;

  const inbound = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();

  r.apiContext = { ...(r.apiContext ?? {}), requestId: id };
  return id;
}

export function getApiContext(req: Request): ApiRequestContext {
  const r = req as ContextualRequest;
  if (!r.apiContext) {
    r.apiContext = { requestId: getRequestId(req) };
  }
  return r.apiContext;
}
