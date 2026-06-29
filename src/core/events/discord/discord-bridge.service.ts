import { Injectable, Logger } from '@nestjs/common';
import { EventBus } from '../event-bus';
import { DISCORD_GATEWAY_MAP } from './discord-gateway.map';
import type {
  DiscordMemberJoinedPayload,
  DiscordMessageDeletedPayload,
} from '../registry/payloads/discord.payloads';

@Injectable()
export class DiscordBridgeService {
  private readonly logger = new Logger(DiscordBridgeService.name);

  constructor(private readonly bus: EventBus) {}

  async onGuildMemberAdd(member: {
    id: string;
    username: string;
    joinedAt: Date | null;
    bot: boolean;
    guild: { id: string };
  }): Promise<void> {
    const mapped = DISCORD_GATEWAY_MAP['guildMemberAdd'];
    if (!mapped) return;

    const payload: DiscordMemberJoinedPayload = {
      userId: member.id,
      username: member.username,
      joinedAt: (member.joinedAt ?? new Date()).toISOString(),
      isBot: member.bot,
    };

    await this.bus.publish(mapped, payload, {
      guildId: member.guild.id,
      actor: { type: 'discord', id: 'gateway' },
      idempotencyKey: `discord.member.joined:${member.id}:${member.guild.id}`,
    });

    this.logger.debug(`Bridged guildMemberAdd for userId=${member.id}`);
  }

  async onMessageDelete(data: {
    id: string;
    channelId: string;
    authorId: string | null;
    guildId: string | null;
  }): Promise<void> {
    const mapped = DISCORD_GATEWAY_MAP['messageDelete'];
    if (!mapped) return;

    const payload: DiscordMessageDeletedPayload = {
      messageId: data.id,
      channelId: data.channelId,
      authorId: data.authorId,
      contentHash: null,
    };

    await this.bus.publish(mapped, payload, {
      guildId: data.guildId,
      actor: { type: 'discord', id: 'gateway' },
    });
  }
}
