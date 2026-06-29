import type { EventName } from '../registry/event-map';

export const DISCORD_GATEWAY_MAP: Record<string, EventName> = {
  guildMemberAdd: 'discord.member.joined',
  messageDelete: 'discord.message.deleted',
};
