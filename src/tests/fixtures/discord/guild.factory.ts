import { mockDeep } from 'vitest-mock-extended';
import type { Guild } from 'discord.js';

export interface GuildOverrides {
  id?: string;
  name?: string;
  ownerId?: string;
}

export function discordGuildFactory(overrides: GuildOverrides = {}): Guild {
  const base = mockDeep<Guild>();
  Object.defineProperty(base, 'id', {
    value: overrides.id ?? 'guild-1',
    configurable: true,
  });
  Object.defineProperty(base, 'name', {
    value: overrides.name ?? 'Test Guild',
    configurable: true,
  });
  Object.defineProperty(base, 'ownerId', {
    value: overrides.ownerId ?? 'owner-1',
    configurable: true,
  });
  return base;
}
