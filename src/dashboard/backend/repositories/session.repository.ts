import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

export interface DashboardSessionRow {
  readonly id: string;
  readonly discordId: string;
  readonly username: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
}

export interface CreateSessionInput {
  readonly discordId: string;
  readonly username: string;
  readonly encryptedRefreshToken: string;
  readonly expiresAt: Date;
}

/** Durable session record store (hot copy lives in Cache). Prisma confined here. */
export abstract class DashboardSessionRepository {
  abstract create(input: CreateSessionInput): Promise<DashboardSessionRow>;
  abstract findActive(id: string): Promise<DashboardSessionRow | null>;
  abstract touch(id: string): Promise<void>;
  abstract revoke(id: string): Promise<void>;
  abstract revokeAllForUser(discordId: string): Promise<number>;
}

@Injectable()
export class PrismaDashboardSessionRepository extends DashboardSessionRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreateSessionInput): Promise<DashboardSessionRow> {
    return this.prisma.dashboardSession.create({
      data: {
        discordId: input.discordId,
        username: input.username,
        refreshToken: input.encryptedRefreshToken,
        expiresAt: input.expiresAt,
      },
      select: this.selection(),
    });
  }

  async findActive(id: string): Promise<DashboardSessionRow | null> {
    return this.prisma.dashboardSession.findFirst({
      where: { id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: this.selection(),
    });
  }

  async touch(id: string): Promise<void> {
    await this.prisma.dashboardSession.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.dashboardSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(discordId: string): Promise<number> {
    const result = await this.prisma.dashboardSession.updateMany({
      where: { discordId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  private selection() {
    return {
      id: true,
      discordId: true,
      username: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      lastSeenAt: true,
    } as const;
  }
}
