import { randomBytes } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import {
  DASHBOARD_CONFIG,
  type DashboardGlobalConfig,
} from '../config/dashboard.config.schema';

export interface TicketPayload {
  readonly sessionId: string;
  readonly discordId: string;
}

/**
 * Issues short-lived, single-use WebSocket tickets stored in the Cache layer.
 * The browser fetches a ticket over authenticated HTTP, then presents it on the
 * WS handshake — keeping the session cookie off the socket query string.
 */
@Injectable()
export class TicketService {
  constructor(
    private readonly cache: CacheService,
    @Inject(DASHBOARD_CONFIG) private readonly config: DashboardGlobalConfig,
  ) {}

  async issue(payload: TicketPayload): Promise<string> {
    const ticket = randomBytes(24).toString('base64url');
    await this.cache.set(this.key(ticket), payload, {
      ttlSeconds: this.config.realtime.ticketTtlSeconds,
      l2Only: true,
    });
    return ticket;
  }

  /** Resolves and consumes a ticket (single-use). */
  async consume(ticket: string): Promise<TicketPayload | null> {
    const key = this.key(ticket);
    const payload = await this.cache.get<TicketPayload>(key);
    if (payload) await this.cache.delete(key);
    return payload;
  }

  private key(ticket: string): string {
    return this.cache.keys.forGlobal(
      CacheNamespace.User,
      'dash',
      'ws-ticket',
      ticket,
    );
  }
}
