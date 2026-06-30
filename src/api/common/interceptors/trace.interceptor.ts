import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { getApiContext } from '../context/request-id';

const TRACE_HEADER = 'x-trace-id';

/**
 * Establishes a trace/span id per request and surfaces it on the response and
 * the request context. When an OpenTelemetry SDK is wired (Phase 6 monitoring),
 * this is the single seam to bind a real span — handlers and logs already read
 * the trace id from here, so nothing downstream changes.
 */
@Injectable()
export class TraceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const inbound = req.headers[TRACE_HEADER];
    const traceId =
      typeof inbound === 'string' && inbound.length > 0
        ? inbound
        : randomBytes(16).toString('hex');

    const apiCtx = getApiContext(req) as { traceId?: string };
    apiCtx.traceId = traceId;
    res.setHeader(TRACE_HEADER, traceId);

    return next.handle();
  }
}
