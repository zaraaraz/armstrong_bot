import { Injectable, Logger } from '@nestjs/common';
import { Context, On, Once, type ContextOf } from 'necord';
import { DiscordBridgeService } from '../../core/events/discord/discord-bridge.service';

/**
 * Bridges raw Discord gateway events onto the internal Event Bus (via
 * DiscordBridgeService) and logs bot readiness. Modules never listen to the
 * gateway directly — they consume the mapped `discord.*` events.
 */
@Injectable()
export class BotGatewayListener {
  private readonly logger = new Logger(BotGatewayListener.name);

  constructor(private readonly bridge: DiscordBridgeService) {}

  @Once('ready')
  onReady(@Context() [client]: ContextOf<'ready'>): void {
    this.logger.log(
      `Discord bot online as ${client.user.tag} in ${client.guilds.cache.size} guild(s)`,
    );
  }

  @On('guildMemberAdd')
  async onMemberAdd(
    @Context() [member]: ContextOf<'guildMemberAdd'>,
  ): Promise<void> {
    await this.bridge.onGuildMemberAdd({
      id: member.id,
      username: member.user.username,
      joinedAt: member.joinedAt,
      bot: member.user.bot,
      guild: { id: member.guild.id },
    });
  }

  @On('messageDelete')
  async onMessageDelete(
    @Context() [message]: ContextOf<'messageDelete'>,
  ): Promise<void> {
    await this.bridge.onMessageDelete({
      id: message.id,
      channelId: message.channelId,
      authorId: message.author?.id ?? null,
      guildId: message.guildId ?? null,
    });
  }
}
