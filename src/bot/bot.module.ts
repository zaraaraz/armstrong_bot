import { Module } from '@nestjs/common';
import { NecordModule } from 'necord';
import { GatewayIntentBits, Partials } from 'discord.js';
import { PingCommand } from './commands/ping.command';
import { BotGatewayListener } from './listeners/bot-gateway.listener';
import { GuildRegistryRepository } from './infrastructure/guild-registry.repository';

/**
 * Discord gateway module. Connects the bot to Discord (Necord + discord.js),
 * registers slash commands, and bridges gateway events onto the internal Event
 * Bus. Intents are the minimum needed for the current listeners; add more as
 * modules require them. DISCORD_TOKEN is validated in core config.
 */
@Module({
  imports: [
    NecordModule.forRoot({
      token: process.env['DISCORD_TOKEN'] ?? '',
      development: process.env['DISCORD_DEV_GUILD_ID']
        ? [process.env['DISCORD_DEV_GUILD_ID']]
        : undefined,
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        // Added for the Logs module (item 19): moderation (ban add/remove) and
        // voice-state logging.
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates,
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        // Uncached message edits/deletes and member updates arrive as partials;
        // the Logs listeners tolerate nulls but these widen coverage.
        Partials.GuildMember,
        Partials.User,
      ],
    }),
  ],
  providers: [PingCommand, BotGatewayListener, GuildRegistryRepository],
})
export class BotModule {}
