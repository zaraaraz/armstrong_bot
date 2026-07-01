import { Injectable, Logger } from '@nestjs/common';
import { Context, On, Once, type ContextOf } from 'necord';
import type { Guild } from 'discord.js';
import { DiscordBridgeService } from '../../core/events/discord/discord-bridge.service';
import {
  GuildRegistryRepository,
  type GuildSnapshot,
} from '../infrastructure/guild-registry.repository';

/**
 * Bridges raw Discord gateway events onto the internal Event Bus (via
 * DiscordBridgeService), keeps the `Guild` table in sync with the bot's real
 * membership (the dashboard's `botPresent` source of truth), and logs bot
 * readiness. Modules never listen to the gateway directly — they consume the
 * mapped `discord.*` events.
 */
@Injectable()
export class BotGatewayListener {
  private readonly logger = new Logger(BotGatewayListener.name);

  constructor(
    private readonly bridge: DiscordBridgeService,
    private readonly guildRegistry: GuildRegistryRepository,
  ) {}

  @Once('ready')
  async onReady(@Context() [client]: ContextOf<'ready'>): Promise<void> {
    this.logger.log(
      `Discord bot online as ${client.user.tag} in ${client.guilds.cache.size} guild(s)`,
    );
    // Reconcile membership observed at startup (covers joins/leaves that
    // happened while the bot was offline).
    const snapshots = client.guilds.cache.map((g) => toSnapshot(g));
    await this.guildRegistry.reconcile(snapshots);
    this.logger.log(`Guild registry reconciled (${snapshots.length} guilds)`);
  }

  @On('guildCreate')
  async onGuildCreate(
    @Context() [guild]: ContextOf<'guildCreate'>,
  ): Promise<void> {
    await this.guildRegistry.upsert(toSnapshot(guild));
    this.logger.log(`Joined guild ${guild.name} (${guild.id})`);
  }

  @On('guildDelete')
  async onGuildDelete(
    @Context() [guild]: ContextOf<'guildDelete'>,
  ): Promise<void> {
    await this.guildRegistry.deactivate(guild.id);
    this.logger.log(`Left guild ${guild.name ?? guild.id} (${guild.id})`);
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

function toSnapshot(guild: Guild): GuildSnapshot {
  return {
    discordId: guild.id,
    name: guild.name,
    iconHash: guild.icon,
    ownerId: guild.ownerId,
  };
}
