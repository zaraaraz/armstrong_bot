import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'discord.js';
import {
  NotificationProvider,
  type NotificationChannel,
  type NotificationRecipient,
  type ProviderSendResult,
  type RenderedMessage,
} from '../notifications.public';

/**
 * Shared Discord transport. The two concrete providers below register under the
 * DISCORD_DM and DISCORD_CHANNEL channels respectively; both send plain-text
 * bodies through discord.js. Errors are mapped onto {@link ProviderSendResult}:
 * unknown-recipient / forbidden are permanent (non-retryable); everything else
 * is treated as retryable so the worker can back off.
 */
abstract class DiscordTransport extends NotificationProvider {
  protected readonly logger = new Logger('notifications.provider.discord');

  constructor(protected readonly client: Client) {
    super();
  }

  healthCheck(): Promise<{ healthy: boolean; detail?: string }> {
    const ready = this.client.isReady();
    return Promise.resolve({
      healthy: ready,
      detail: ready ? `ws ${Math.round(this.client.ws.ping)}ms` : 'not ready',
    });
  }

  protected permanent(error: string): ProviderSendResult {
    return { ok: false, retryable: false, error };
  }

  protected transient(error: string): ProviderSendResult {
    return { ok: false, retryable: true, error };
  }

  protected fromError(err: unknown): ProviderSendResult {
    const code = (err as { code?: number | string })?.code;
    const message = err instanceof Error ? err.message : String(err);
    // 10003 Unknown Channel, 10013 Unknown User, 50007 Cannot DM user,
    // 50001 Missing Access, 50013 Missing Permissions — all permanent.
    const permanentCodes = new Set([10003, 10013, 50007, 50001, 50013]);
    if (typeof code === 'number' && permanentCodes.has(code)) {
      return this.permanent(message);
    }
    return this.transient(message);
  }
}

@Injectable()
export class DiscordDmProvider extends DiscordTransport {
  readonly channel: NotificationChannel = 'DISCORD_DM';

  async send(
    recipient: NotificationRecipient,
    message: RenderedMessage,
  ): Promise<ProviderSendResult> {
    if (!recipient.userId) {
      return this.permanent('DISCORD_DM requires a recipient userId');
    }
    if (!this.client.isReady()) {
      return this.transient('discord client not ready');
    }
    try {
      const user = await this.client.users.fetch(recipient.userId);
      const sent = await user.send({ content: message.body });
      return { ok: true, providerMessageId: sent.id, retryable: false };
    } catch (err) {
      return this.fromError(err);
    }
  }
}

@Injectable()
export class DiscordChannelProvider extends DiscordTransport {
  readonly channel: NotificationChannel = 'DISCORD_CHANNEL';

  async send(
    recipient: NotificationRecipient,
    message: RenderedMessage,
  ): Promise<ProviderSendResult> {
    if (!recipient.channelId) {
      return this.permanent('DISCORD_CHANNEL requires a recipient channelId');
    }
    if (!this.client.isReady()) {
      return this.transient('discord client not ready');
    }
    try {
      const channel = await this.client.channels.fetch(recipient.channelId);
      if (!channel || !channel.isTextBased() || !('send' in channel)) {
        return this.permanent('target channel is not text-sendable');
      }
      const sent = await channel.send({ content: message.body });
      return { ok: true, providerMessageId: sent.id, retryable: false };
    } catch (err) {
      return this.fromError(err);
    }
  }
}
