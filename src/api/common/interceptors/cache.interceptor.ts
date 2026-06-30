import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { from, type Observable } from 'rxjs';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import { getApiContext } from '../context/request-id';
import {
  CACHE_RESPONSE_KEY,
  type CacheResponseOptions,
} from '../decorators/cache-response.decorator';

/**
 * Caches GET responses flagged with {@link CacheResponse} through the Cache
 * layer. The cache key is derived from the route path, the resolved scope
 * (guild/actor/global) and the querystring so distinct queries don't collide.
 */
@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<
      CacheResponseOptions | undefined
    >(CACHE_RESPONSE_KEY, [context.getHandler(), context.getClass()]);

    const req = context.switchToHttp().getRequest<Request>();
    if (!options || req.method !== 'GET') {
      return next.handle();
    }

    const key = this.buildKey(req, options);
    return from(
      this.cache.getOrSet(key, () => firstValueFromHandler(next.handle()), {
        ttlSeconds: options.ttlSeconds,
        jitterSeconds: 5,
      }),
    );
  }

  private buildKey(req: Request, options: CacheResponseOptions): string {
    const ctx = getApiContext(req);
    const route =
      (req as { route?: { path?: string } }).route?.path ?? req.path;
    const query = new URLSearchParams(
      req.query as Record<string, string>,
    ).toString();
    const suffix = `${route}?${query}`;

    if (options.scope === 'guild' && ctx.guild) {
      return this.cache.keys.forGuild(
        ctx.guild.guildId,
        CacheNamespace.Generic,
        'api',
        suffix,
      );
    }
    if (options.scope === 'actor' && ctx.actor) {
      return this.cache.keys.forGlobal(
        CacheNamespace.Generic,
        'api',
        'actor',
        ctx.actor.id,
        suffix,
      );
    }
    return this.cache.keys.forGlobal(CacheNamespace.Generic, 'api', suffix);
  }
}

/** Resolves the first emission of a handler Observable into a Promise. */
function firstValueFromHandler(source: Observable<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const sub = source.subscribe({
      next: (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
          sub.unsubscribe();
        }
      },
      error: reject,
      complete: () => {
        if (!settled) resolve(undefined);
      },
    });
  });
}
