import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { EventBus } from '../../../core/events/event-bus';
import { PermissionService } from '../../../core/permissions/application/permission.service';
import { Claim } from '../../../core/permissions/domain/claim.value-object';
import { ApiException } from '../../common/errors/api-exception';
import { getApiContext } from '../../common/context/request-id';
import { REQUIRE_CLAIMS_KEY } from '../../common/decorators/require-claims.decorator';

/**
 * Enforces `@RequireClaims()`. Service/JWT actors are checked against the claim
 * set carried by their key/token (wildcard-aware via {@link Claim.covers}).
 * Session users are delegated to the Permissions core, which resolves
 * groups/inheritance/roles. Missing any required claim → 403 + `api.auth.failed`
 * is not emitted (that's for authn); instead a `security.permission.denied`-shaped
 * decision is left to the Permissions core's own eventing.
 */
@Injectable()
export class ApiPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
    @Inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRE_CLAIMS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ctx = getApiContext(req);
    const actor = ctx.actor;
    if (!actor) throw ApiException.unauthorized();

    for (const claim of required) {
      const ok = await this.satisfies(ctx, actor.type, claim);
      if (!ok) throw ApiException.forbidden();
    }
    return true;
  }

  private async satisfies(
    ctx: ReturnType<typeof getApiContext>,
    actorType: 'user' | 'service',
    claim: string,
  ): Promise<boolean> {
    const required = Claim.parse(claim);

    // Service/JWT: match the claim set carried by the key/token.
    if (actorType === 'service' || ctx.actor?.method === 'jwt') {
      const held = ctx.actor?.claims ?? new Set<string>();
      const granted = [...held].some((h) => Claim.parse(h).covers(required));
      if (!granted) return false;
      // For a key bound to a guild, the guild guard already scoped it.
      if (ctx.actor?.method === 'jwt') return true;
      // API keys: effective claims also require the guild owner/role check is
      // unnecessary — the key itself is the authorization grant.
      return true;
    }

    // Session user: delegate to the Permissions core for full resolution.
    if (!ctx.user || !ctx.user.guildId) return false;
    return this.permissions.can(
      {
        userId: ctx.user.id,
        guildId: ctx.user.guildId,
        discordRoleIds: ctx.user.discordRoleIds,
        isGuildOwner: ctx.user.isGuildOwner,
      },
      claim,
    );
  }
}
