import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { BackupView } from '../interfaces/dashboard.interfaces';

interface BackupRow {
  id: string;
  guildId: string;
  status: string;
  jobId: string | null;
  sizeBytes: bigint | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

function toView(row: BackupRow): BackupView {
  return {
    id: row.id,
    guildId: row.guildId,
    status: row.status,
    jobId: row.jobId,
    sizeBytes: row.sizeBytes !== null ? Number(row.sizeBytes) : null,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export abstract class BackupRepository {
  abstract create(guildId: string, requestedBy: string): Promise<BackupView>;
  abstract findById(guildId: string, id: string): Promise<BackupView | null>;
  abstract listByGuild(
    guildId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: BackupView[]; total: number }>;
}

@Injectable()
export class PrismaBackupRepository extends BackupRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(guildId: string, requestedBy: string): Promise<BackupView> {
    const row = await this.prisma.backup.create({
      data: { guildId, requestedBy, status: 'pending' },
    });
    return toView(row);
  }

  async findById(guildId: string, id: string): Promise<BackupView | null> {
    const row = await this.prisma.backup.findFirst({
      where: { id, guildId, deletedAt: null },
    });
    return row ? toView(row) : null;
  }

  async listByGuild(
    guildId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: BackupView[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.backup.findMany({
        where: { guildId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.backup.count({ where: { guildId, deletedAt: null } }),
    ]);
    return { items: rows.map(toView), total };
  }
}
