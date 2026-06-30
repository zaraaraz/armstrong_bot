import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { type Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { EventBus } from '../../../core/events/event-bus';
import { getApiContext } from '../context/request-id';

/**
 * Logs one structured line per request (category `api.request`) and publishes
 * `api.request.completed` onto the Event Bus for observability/metrics. Never
 * logs request bodies (handled by the security AuditInterceptor for writes).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('api.request');

  constructor(@Inject(EventBus) private readonly eventBus: EventBus) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const ctx = getApiContext(req);
    const startedAt = Date.now();

    const finalize = (): void => {
      const durationMs = Date.now() - startedAt;
      const path =
        (req as { route?: { path?: string } }).route?.path ?? req.path;
      this.logger.log({
        msg: 'api.request',
        requestId: ctx.requestId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs,
        actorId: ctx.actor?.id ?? null,
        guildId: ctx.guild?.guildId ?? null,
      });

      void this.eventBus.publish(
        'api.request.completed',
        {
          requestId: ctx.requestId,
          actorId: ctx.actor?.id ?? null,
          method: req.method,
          path,
          status: res.statusCode,
          durationMs,
          guildId: ctx.guild?.guildId ?? null,
        },
        { actor: { type: 'api', id: 'api' } },
      );
    };

    return next.handle().pipe(tap({ next: finalize, error: finalize }));
  }
}
