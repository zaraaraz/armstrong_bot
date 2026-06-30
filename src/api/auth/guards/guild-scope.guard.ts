import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../../common/errors/api-exception';
import { getApiContext } from '../../common/context/request-id';
import { GuildLookupRepository } from '../../repositories/guild-lookup.repository';
import { SessionStore } from '../session.store';
import { parseCookies } from '../../common/http/cookies';
import { API_CONFIG, type ApiConfig } from '../../config/api.config';
import { Inject } from '@nestjs/common';

/**
 * Resolves the `:guildId` route param into a {@link GuildContext} and authorizes
 * the actor's guild scope. For session users it also enriches the `user` mirror
 * with the user's roles/ownership in that guild, so the downstream permissions
 * guard can evaluate role-derived claims. Runs after {@link CompositeAuthGuard}.
 */
@Injectable()
export class GuildScopeGuard implements CanActivate {
  constructor(
    private readonly guilds: GuildLookupRepository,
    private readonly sessions: SessionStore,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const guildId = (req.params as Record<string, string>)?.guildId;
    if (!guildId) return true; // not a guild-scoped route

    const ctx = getApiContext(req);
    const actor = ctx.actor;
    if (!actor) throw ApiException.unauthorized();

    // Service/JWT actors must carry the guild in their scope (empty => global).
    if (actor.type === 'service' || actor.method === 'jwt') {
      if (actor.guildScope.size > 0 && !actor.guildScope.has(guildId)) {
        throw ApiException.notFound();
      }
    } else if (!actor.guildScope.has(guildId)) {
      // Never confirm a guild's existence to a user who can't access it.
      throw ApiException.notFound();
    }

    const guild = await this.guilds.findByDiscordId(guildId);
    const locale = guild?.locale ?? 'pt';

    ctx.guild = { guildId, locale };

    if (actor.type === 'user') {
      await this.enrichUser(req, ctx, guildId);
    } else {
      ctx.user = {
        id: actor.id,
        guildId,
        discordRoleIds: [],
        isGuildOwner: false,
      };
    }
    return true;
  }

  private async enrichUser(
    req: Request,
    ctx: ReturnType<typeof getApiContext>,
    guildId: string,
  ): Promise<void> {
    const sessionId = parseCookies(req)[this.config.session.cookieName];
    const data = sessionId ? await this.sessions.resolve(sessionId) : null;
    const membership = data?.guilds.find((g) => g.guildId === guildId);
    ctx.user = {
      id: ctx.actor?.id ?? '',
      guildId,
      discordRoleIds: membership?.roleIds ?? [],
      isGuildOwner: membership?.isOwner ?? false,
    };
  }
}
