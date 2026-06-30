import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { Client } from 'discord.js';

export type MockDiscordClient = DeepMockProxy<Client>;

export function createMockDiscordClient(): MockDiscordClient {
  return mockDeep<Client>();
}
