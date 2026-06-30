import type { Factory } from './factory';

export interface GuildShape {
  id: string;
  discordId: string;
  name: string;
  iconHash: string | null;
  ownerId: string;
  locale: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

let seq = 0;

function buildGuild(overrides?: Partial<GuildShape>): GuildShape {
  seq++;
  return {
    id: `guild-cuid-${seq}`,
    discordId: `200000000000000${seq.toString().padStart(3, '0')}`,
    name: `Test Guild ${seq}`,
    iconHash: null,
    ownerId: `300000000000000${seq.toString().padStart(3, '0')}`,
    locale: 'pt',
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

export const guildFactory: Factory<GuildShape> = {
  build: (overrides?) => buildGuild(overrides),
  buildMany: (count, overrides?) =>
    Array.from({ length: count }, () => buildGuild(overrides)),
};
