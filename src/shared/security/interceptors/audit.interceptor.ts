import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { redact } from '../services/redaction.serializer';

interface AuditRequest extends Request {
  user?: { id?: string; guildId?: string };
  apiKey?: { id?: string };
}

function routePath(req: Request): string {
  const route = (req as { route?: { path?: string } }).route;
  return route?.path ?? req.path;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records a redacted audit line for every state-changing request. Once the
 * Audit module (Phase 4) lands, this is where `audit.*` events get published
 * to the bus; until then it emits a structured `warn`/`log` trail so the
 * action is never silent. Secrets are scrubbed via {@link redact}.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('security.audit');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuditRequest>();

    if (!STATE_CHANGING.has(req.method)) {
      return next.handle();
    }

    const entry = {
      msg: 'audit.action',
      method: req.method,
      route: routePath(req),
      actorId: req.user?.id ?? req.apiKey?.id ?? 'anonymous',
      guildId: req.user?.guildId ?? null,
      body: redact(req.body as unknown),
    };

    return next.handle().pipe(
      tap({
        next: () => this.logger.log(entry),
        error: (err: unknown) =>
          this.logger.warn({ ...entry, failed: true, error: String(err) }),
      }),
    );
  }
}
