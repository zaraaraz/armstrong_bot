import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export interface AuditEntryInput {
  readonly guildId: string;
  readonly actorId: string;
  readonly action: string;
  readonly target?: string | null;
  readonly metadata?: Record<string, unknown> | null;
}

export interface AuditEntryView {
  readonly id: string;
  readonly guildId: string;
  readonly actorId: string;
  readonly action: string;
  readonly target: string | null;
  readonly createdAt: Date;
}

/** Append-only dashboard audit log. Prisma confined here. */
export abstract class DashboardAuditRepository {
  abstract record(input: AuditEntryInput): Promise<void>;
  abstract recent(guildId: string, limit: number): Promise<AuditEntryView[]>;
}

@Injectable()
export class PrismaDashboardAuditRepository extends DashboardAuditRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async record(input: AuditEntryInput): Promise<void> {
    await this.prisma.dashboardAuditEntry.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        action: input.action,
        target: input.target ?? null,
        metadata: (input.metadata ?? undefined) as
          Prisma.InputJsonValue | undefined,
      },
    });
  }

  async recent(guildId: string, limit: number): Promise<AuditEntryView[]> {
    const rows = await this.prisma.dashboardAuditEntry.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        guildId: true,
        actorId: true,
        action: true,
        target: true,
        createdAt: true,
      },
    });
    return rows;
  }
}
