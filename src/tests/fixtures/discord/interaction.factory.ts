import { mockDeep } from 'vitest-mock-extended';
import type { ChatInputCommandInteraction } from 'discord.js';

export interface InteractionOverrides {
  guildId?: string;
  commandName?: string;
  userId?: string;
  username?: string;
}

export function chatInputInteractionFactory(
  overrides: InteractionOverrides = {},
): ChatInputCommandInteraction {
  const base = mockDeep<ChatInputCommandInteraction>();
  const guildId = overrides.guildId ?? 'guild-1';
  const userId = overrides.userId ?? 'user-1';
  const username = overrides.username ?? 'testuser';

  Object.defineProperty(base, 'guildId', {
    value: guildId,
    configurable: true,
  });
  Object.defineProperty(base, 'commandName', {
    value: overrides.commandName ?? 'test',
    configurable: true,
  });
  Object.defineProperty(base, 'user', {
    value: { id: userId, username, bot: false },
    configurable: true,
  });

  return base;
}
