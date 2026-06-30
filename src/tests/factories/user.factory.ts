import type { Factory } from './factory';

export interface UserShape {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
  bot: boolean;
  locale: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

let seq = 0;

function buildUser(overrides?: Partial<UserShape>): UserShape {
  seq++;
  return {
    id: `user-cuid-${seq}`,
    discordId: `100000000000000${seq.toString().padStart(3, '0')}`,
    username: `testuser${seq}`,
    globalName: null,
    avatarHash: null,
    bot: false,
    locale: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

export const userFactory: Factory<UserShape> = {
  build: (overrides?) => buildUser(overrides),
  buildMany: (count, overrides?) =>
    Array.from({ length: count }, () => buildUser(overrides)),
};
