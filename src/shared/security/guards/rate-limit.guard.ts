import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { EventBus } from '../../../core/events/event-bus';
import { RateLimitService } from '../services/rate-limit.service';
import { RATE_LIMIT_KEY } from '../decorators/rate-limit.decorator';
import { SecurityEvents } from '../security.events';
import type { RateLimitOptions } from '../interfaces/security.interfaces';

interface AuthedRequest extends Request {
  user?: { id?: string; guildId?: string };
  apiKey?: { id?: string };
}

function routePath(req: Request): string {
  const route = (req as { route?: { path?: string } }).route;
  return route?.path ?? req.path;
}

/**
 * Enforces the @RateLimit declared on a handler. On exhaustion it publishes
 * `security.rate_limit.exceeded` and throws 429 with a `Retry-After` header.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
    @Inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<
      RateLimitOptions | undefined
    >(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);

    if (!options) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const subject = this.deriveKey(req, options);
    const route = `${req.method} ${routePath(req)}`;
    const bucketKey = `${route}:${subject}`;

    const result = await this.rateLimit.consume(bucketKey, options);
    if (result.allowed) return true;

    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Retry-After', Math.ceil(result.retryAfterMs / 1000));

    await this.eventBus.publish(
      SecurityEvents.RateLimitExceeded,
      {
        key: subject,
        by: options.by,
        route,
        guildId: req.user?.guildId ?? null,
      },
      { actor: { type: 'system', id: 'security' } },
    );

    throw new HttpException(
      'Rate limit exceeded',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private deriveKey(req: AuthedRequest, options: RateLimitOptions): string {
    switch (options.by) {
      case 'user':
        return req.user?.id ?? req.ip ?? 'anonymous';
      case 'guild':
        return req.user?.guildId ?? 'no-guild';
      case 'api-key':
        return req.apiKey?.id ?? req.ip ?? 'anonymous';
      case 'ip':
        return req.ip ?? 'unknown-ip';
      case 'global':
        return 'global';
    }
  }
}
