import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { getRequestId, REQUEST_ID_HEADER } from '../context/request-id';
import {
  isEnvelope,
  isPaginatedEnvelope,
  type ResponseMeta,
  type SuccessEnvelope,
} from './response-envelope';

/**
 * Wraps every successful handler return in a {@link SuccessEnvelope}. Handlers
 * that already returned a pre-built envelope (e.g. a {@link PaginatedEnvelope}
 * from the pagination helper) pass through untouched. Also stamps the
 * `X-Request-Id` response header for correlation.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = getRequestId(req);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const meta: ResponseMeta = {
      requestId,
      timestamp: new Date().toISOString(),
      version: 'v1',
    };

    return next.handle().pipe(
      map((data: unknown): unknown => {
        if (data === undefined || data === null) return data;
        // Pre-built paginated envelopes: stamp the authoritative meta so the
        // handler doesn't need access to the request id.
        if (isPaginatedEnvelope(data)) {
          return { ...data, meta };
        }
        if (isEnvelope(data)) return data;
        const envelope: SuccessEnvelope<unknown> = {
          success: true,
          data,
          meta,
        };
        return envelope;
      }),
    );
  }
}
