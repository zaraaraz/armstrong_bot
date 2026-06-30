import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../errors/api-exception';
import { getApiContext } from '../context/request-id';
import type { GuildContext } from '../context/api-actor';

/**
 * Injects the resolved {@link GuildContext} for guild-scoped routes. The
 * GuildScopeGuard must have run first; otherwise this throws a 404 (we never
 * confirm a guild exists to an unauthorized caller).
 */
export const CurrentGuild = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): GuildContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const guild = getApiContext(req).guild;
    if (!guild) throw ApiException.notFound();
    return guild;
  },
);
