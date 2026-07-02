import { Injectable } from '@nestjs/common';
import {
  Context,
  Options,
  SlashCommand,
  StringOption,
  type SlashCommandContext,
} from 'necord';
import { INotificationService } from '../notifications.public';
import { IntegrationSubscriptionRepository } from '../infrastructure/integration-subscription.repository';
import { NotificationPreferenceRepository } from '../infrastructure/notification-preference.repository';
import type { NotificationCategory } from '../notifications.public';

class NotifyTestDto {
  @StringOption({
    name: 'category',
    description: 'Notification category to test',
    required: true,
    choices: [
      { name: 'system', value: 'system' },
      { name: 'moderation', value: 'moderation' },
      { name: 'tickets', value: 'tickets' },
      { name: 'integrations', value: 'integrations' },
      { name: 'digest', value: 'digest' },
      { name: 'marketing', value: 'marketing' },
    ],
  })
  category!: string;

  @StringOption({
    name: 'channel',
    description: 'Force a specific channel (optional)',
    required: false,
    choices: [
      { name: 'DM', value: 'DISCORD_DM' },
      { name: 'Channel', value: 'DISCORD_CHANNEL' },
    ],
  })
  channel?: string;
}

class IntegrationAddDto {
  @StringOption({
    name: 'provider',
    description: 'Integration provider',
    required: true,
    choices: [
      { name: 'Twitch', value: 'TWITCH' },
      { name: 'YouTube', value: 'YOUTUBE' },
      { name: 'GitHub', value: 'GITHUB' },
    ],
  })
  provider!: string;

  @StringOption({
    name: 'external_id',
    description: 'Twitch login / YouTube channel id / GitHub repo',
    required: true,
  })
  externalId!: string;

  @StringOption({
    name: 'channel_id',
    description: 'Announce channel id (optional)',
    required: false,
  })
  channelId?: string;
}

class IntegrationRemoveDto {
  @StringOption({
    name: 'id',
    description: 'Subscription id to remove',
    required: true,
  })
  id!: string;
}

/**
 * Necord slash commands for quick notification management from Discord. Each
 * command is guild-scoped from the interaction and replies ephemerally. Heavy
 * lifting is delegated to the public service / repositories — the commands hold
 * no business logic.
 */
@Injectable()
export class NotificationsCommands {
  constructor(
    private readonly service: INotificationService,
    private readonly subs: IntegrationSubscriptionRepository,
    private readonly prefs: NotificationPreferenceRepository,
  ) {}

  @SlashCommand({
    name: 'notify-test',
    description: 'Send a test notification to this channel',
  })
  async notifyTest(
    @Context() [interaction]: SlashCommandContext,
    @Options() opts: NotifyTestDto,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Guild only.', ephemeral: true });
      return;
    }
    const result = await this.service.dispatch({
      guildId: interaction.guildId,
      category: opts.category as NotificationCategory,
      priority: 'normal',
      templateKey: 'system.test',
      vars: { by: interaction.user.username },
      recipients: [{ channelId: interaction.channelId }],
      channels: opts.channel
        ? [opts.channel as 'DISCORD_DM' | 'DISCORD_CHANNEL']
        : ['DISCORD_CHANNEL'],
      dedupeKey: `notify-test:${interaction.id}`,
    });
    await interaction.reply({
      content: `Dispatched \`${result.notificationId}\` — ${result.enqueuedDeliveries} delivery(ies) queued, ${result.skipped.length} skipped.`,
      ephemeral: true,
    });
  }

  @SlashCommand({
    name: 'notifications-prefs',
    description: 'Show your notification preferences in this guild',
  })
  async prefsCommand(
    @Context() [interaction]: SlashCommandContext,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Guild only.', ephemeral: true });
      return;
    }
    const rows = await this.prefs.findForUser(
      interaction.guildId,
      interaction.user.id,
    );
    const body =
      rows.length === 0
        ? 'You have no custom preferences — all guild defaults apply.'
        : rows
            .map(
              (r) =>
                `• ${r.category}/${r.channel}: ${r.enabled ? 'on' : 'off'}`,
            )
            .join('\n');
    await interaction.reply({ content: body, ephemeral: true });
  }

  @SlashCommand({
    name: 'notify-integration-add',
    description: 'Subscribe to a Twitch/YouTube/GitHub source',
  })
  async integrationAdd(
    @Context() [interaction]: SlashCommandContext,
    @Options() opts: IntegrationAddDto,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Guild only.', ephemeral: true });
      return;
    }
    const record = await this.subs.create({
      guildId: interaction.guildId,
      provider: opts.provider as 'TWITCH' | 'YOUTUBE' | 'GITHUB',
      externalId: opts.externalId,
      announceChannelId: opts.channelId ?? interaction.channelId,
    });
    await interaction.reply({
      content: `Subscribed to ${record.provider} \`${record.externalId}\` (id \`${record.id}\`).`,
      ephemeral: true,
    });
  }

  @SlashCommand({
    name: 'notify-integration-remove',
    description: 'Remove an integration subscription',
  })
  async integrationRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() opts: IntegrationRemoveDto,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Guild only.', ephemeral: true });
      return;
    }
    const record = await this.subs.findById(opts.id);
    if (!record || record.guildId !== interaction.guildId) {
      await interaction.reply({
        content: 'Subscription not found.',
        ephemeral: true,
      });
      return;
    }
    await this.subs.softDelete(opts.id);
    await interaction.reply({
      content: `Removed subscription \`${opts.id}\`.`,
      ephemeral: true,
    });
  }
}
