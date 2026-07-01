import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, type SlashCommandContext } from 'necord';

/** Minimal liveness command: `/ping` → replies with the gateway latency. */
@Injectable()
export class PingCommand {
  @SlashCommand({ name: 'ping', description: 'Check that the bot is alive' })
  async onPing(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const ws = Math.round(interaction.client.ws.ping);
    await interaction.reply({
      content: `🏓 Pong! Gateway latency: ${ws}ms`,
      ephemeral: true,
    });
  }
}
