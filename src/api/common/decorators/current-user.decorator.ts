import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../errors/api-exception';
import { getApiContext } from '../context/request-id';
import type { AuthenticatedActor } from '../context/api-actor';

/** Injects the authenticated actor; throws 401 if the route ran unauthenticated. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedActor => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const actor = getApiContext(req).actor;
    if (!actor) throw ApiException.unauthorized();
    return actor;
  },
);
