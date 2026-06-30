import { Inject, Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';
import { API_CONFIG, type ApiConfig } from '../config/api.config';
import { JwtService } from '../auth/jwt.service';
import { SessionStore } from '../auth/session.store';
import type { AuthenticatedActor } from '../common/context/api-actor';

/**
 * Authenticates a WebSocket handshake by reusing the same session/JWT logic as
 * REST. Returns the resolved actor (with per-guild role data for users) or null
 * to reject the connection.
 */
@Injectable()
export class RealtimeAuth {
  constructor(
    private readonly sessions: SessionStore,
    private readonly jwt: JwtService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async authenticate(socket: Socket): Promise<{
    actor: AuthenticatedActor;
    guildScope: ReadonlySet<string>;
  } | null> {
    const sessionActor = await this.fromSession(socket);
    if (sessionActor) return sessionActor;
    return this.fromJwt(socket);
  }

  private async fromSession(socket: Socket): Promise<{
    actor: AuthenticatedActor;
    guildScope: ReadonlySet<string>;
  } | null> {
    const sessionId = this.cookie(socket, this.config.session.cookieName);
    if (!sessionId) return null;
    const data = await this.sessions.resolve(sessionId);
    if (!data) return null;
    const guildScope = new Set(data.guilds.map((g) => g.guildId));
    return {
      actor: {
        id: data.userId,
        type: 'user',
        method: 'session',
        displayName: data.displayName,
        claims: new Set<string>(),
        guildScope,
      },
      guildScope,
    };
  }

  private fromJwt(socket: Socket): {
    actor: AuthenticatedActor;
    guildScope: ReadonlySet<string>;
  } | null {
    const token =
      this.queryParam(socket, 'token') ?? this.bearer(socket) ?? null;
    if (!token) return null;
    const claims = this.jwt.verify(token);
    if (!claims) return null;
    const guildScope = new Set(claims.guilds);
    return {
      actor: {
        id: claims.sub,
        type: claims.type,
        method: 'jwt',
        displayName: claims.name,
        claims: new Set(claims.scopes),
        guildScope,
      },
      guildScope,
    };
  }

  private cookie(socket: Socket, name: string): string | null {
    const header = socket.handshake.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === name) {
        return decodeURIComponent(part.slice(idx + 1).trim());
      }
    }
    return null;
  }

  private queryParam(socket: Socket, key: string): string | null {
    const value = socket.handshake.query[key];
    return typeof value === 'string' ? value : null;
  }

  private bearer(socket: Socket): string | null {
    const auth = socket.handshake.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice('Bearer '.length);
    }
    return null;
  }
}
