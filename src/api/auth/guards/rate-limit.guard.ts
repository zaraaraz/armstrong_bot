import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { EventBus } from '../../../core/events/event-bus';
import { RateLimitService } from '../../../shared/security/services/rate-limit.service';
import { API_CONFIG, type ApiConfig } from '../../config/api.config';
import { ApiException } from '../../common/errors/api-exception';
import { getApiContext } from '../../common/context/request-id';

/**
 * Per-actor sliding-window rate limiting layered on the security
 * {@link RateLimitService}. Tier is chosen by auth method (anonymous < user <
 * api-key). Emits standard `X-RateLimit-*` headers and `Retry-After` on 429.
 * Runs after authentication so the actor tier is known.
 */
@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    @Inject(EventBus) private readonly eventBus: EventBus,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const ctx = getApiContext(req);

    const { key, points, by } = this.bucket(req, ctx);
    const result = await this.rateLimit.consume(key, {
      points,
      duration: this.config.rateLimit.windowSeconds,
      by,
    });

    res.setHeader('X-RateLimit-Limit', String(points));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader(
      'X-RateLimit-Reset',
      String(Math.ceil((Date.now() + result.retryAfterMs) / 1000)),
    );

    if (!result.allowed) {
      const retryAfter = Math.ceil(result.retryAfterMs / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      await this.eventBus.publish(
        'security.rate_limit.exceeded',
        { key, by, route: req.path, guildId: ctx.guild?.guildId ?? null },
        { actor: { type: 'api', id: 'api' } },
      );
      throw ApiException.rateLimited();
    }
    return true;
  }

  private bucket(
    req: Request,
    ctx: ReturnType<typeof getApiContext>,
  ): { key: string; points: number; by: 'user' | 'api-key' | 'ip' } {
    const actor = ctx.actor;
    if (actor?.method === 'api-key') {
      return {
        key: `api:key:${actor.id}`,
        points: this.config.rateLimit.apiKeyMax,
        by: 'api-key',
      };
    }
    if (actor) {
      return {
        key: `api:user:${actor.id}`,
        points: this.config.rateLimit.userMax,
        by: 'user',
      };
    }
    return {
      key: `api:ip:${req.ip ?? 'unknown'}`,
      points: this.config.rateLimit.anonymousMax,
      by: 'ip',
    };
  }
}
