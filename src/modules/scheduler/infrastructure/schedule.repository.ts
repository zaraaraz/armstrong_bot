import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type {
  ScheduleEntity,
  ScheduleRunEntity,
  ScheduleStatus,
  ScheduleType,
} from '../domain/schedule.entity';

interface ScheduleRow {
  id: string;
  guildId: string | null;
  kind: string;
  type: ScheduleType;
  status: ScheduleStatus;
  payload: unknown;
  idempotencyKey: string | null;
  cron: string | null;
  everyMs: number | null;
  timezone: string;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  deferrable: boolean;
  maxAttempts: number;
  bullJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface ScheduleRunRow {
  id: string;
  scheduleId: string;
  guildId: string | null;
  attempt: number;
  status: ScheduleStatus;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  error: string | null;
  traceId: string | null;
}

export interface CreateScheduleInput {
  guildId: string | null;
  kind: string;
  type: ScheduleType;
  status: ScheduleStatus;
  payload: unknown;
  idempotencyKey: string | null;
  cron: string | null;
  everyMs: number | null;
  timezone: string;
  nextRunAt: Date | null;
  deferrable: boolean;
  maxAttempts: number;
  bullJobId: string | null;
}

export interface ListSchedulesQuery {
  guildId?: string | null;
  kind?: string;
  status?: ScheduleStatus;
  page: number;
  pageSize: number;
  /** When true, soft-deleted rows are included (admin/debug only). */
  withDeleted?: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * The ONLY class permitted to touch the scheduler Prisma tables. Encapsulates
 * soft-delete, pagination and the dedup lookup. Repository Pattern per the spec.
 */
@Injectable()
export class ScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get schedules() {
    return this.prisma['schedule'];
  }

  private get runs() {
    return this.prisma['scheduleRun'];
  }

  async create(input: CreateScheduleInput): Promise<ScheduleEntity> {
    const row = (await this.schedules.create({
      data: { ...input, payload: input.payload as object },
    })) as ScheduleRow;
    return toEntity(row);
  }

  async findById(
    id: string,
    guildId: string | null | undefined,
  ): Promise<ScheduleEntity | null> {
    const row = (await this.schedules.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(guildId !== undefined ? { guildId } : {}),
      },
    })) as ScheduleRow | null;
    return row ? toEntity(row) : null;
  }

  /** Look up an existing schedule by its dedup tuple (for idempotent replace). */
  async findByDedup(
    guildId: string | null,
    kind: string,
    idempotencyKey: string,
  ): Promise<ScheduleEntity | null> {
    const row = (await this.schedules.findFirst({
      where: { guildId, kind, idempotencyKey, deletedAt: null },
    })) as ScheduleRow | null;
    return row ? toEntity(row) : null;
  }

  async update(
    id: string,
    data: Partial<{
      status: ScheduleStatus;
      payload: unknown;
      cron: string | null;
      everyMs: number | null;
      timezone: string;
      nextRunAt: Date | null;
      lastRunAt: Date | null;
      deferrable: boolean;
      maxAttempts: number;
      bullJobId: string | null;
    }>,
  ): Promise<ScheduleEntity> {
    const row = (await this.schedules.update({
      where: { id },
      data: { ...data, payload: data.payload as object | undefined },
    })) as ScheduleRow;
    return toEntity(row);
  }

  async softDelete(id: string): Promise<void> {
    await this.schedules.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'cancelled' },
    });
  }

  /** Soft-delete every (non-deleted) schedule for a guild — `guild.deleted` cascade. */
  async softDeleteByGuild(guildId: string): Promise<ScheduleEntity[]> {
    const rows = (await this.schedules.findMany({
      where: { guildId, deletedAt: null },
    })) as ScheduleRow[];
    if (rows.length > 0) {
      await this.schedules.updateMany({
        where: { guildId, deletedAt: null },
        data: { deletedAt: new Date(), status: 'cancelled' },
      });
    }
    return rows.map(toEntity);
  }

  /** All live recurring schedules — used by the reconciler to re-hydrate BullMQ. */
  async findActiveRecurring(): Promise<ScheduleEntity[]> {
    const rows = (await this.schedules.findMany({
      where: {
        type: 'recurring',
        deletedAt: null,
        status: { in: ['active', 'pending', 'paused'] },
      },
    })) as ScheduleRow[];
    return rows.map(toEntity);
  }

  async list(query: ListSchedulesQuery): Promise<Paginated<ScheduleEntity>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const where = {
      ...(query.withDeleted ? {} : { deletedAt: null }),
      ...(query.guildId !== undefined ? { guildId: query.guildId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.schedules.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }) as Promise<ScheduleRow[]>,
      this.schedules.count({ where }) as Promise<number>,
    ]);

    return { items: rows.map(toEntity), total, page, pageSize };
  }

  /** Count live schedules in a given status (used for DLQ-size health signal). */
  async countByStatus(status: ScheduleStatus): Promise<number> {
    return this.schedules.count({
      where: { status, deletedAt: null },
    });
  }

  // ─── Runs ────────────────────────────────────────────────────────────────

  async createRun(input: {
    scheduleId: string;
    guildId: string | null;
    attempt: number;
    status: ScheduleStatus;
    traceId: string | null;
  }): Promise<ScheduleRunEntity> {
    const row = await this.runs.create({ data: input });
    return toRunEntity(row);
  }

  async finishRun(
    runId: string,
    data: {
      status: ScheduleStatus;
      durationMs: number;
      error?: string | null;
    },
  ): Promise<void> {
    await this.runs.update({
      where: { id: runId },
      data: {
        status: data.status,
        finishedAt: new Date(),
        durationMs: data.durationMs,
        error: data.error ?? null,
      },
    });
  }

  async listRuns(
    scheduleId: string,
    page: number,
    pageSize: number,
  ): Promise<Paginated<ScheduleRunEntity>> {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const where = { scheduleId };
    const [rows, total] = await Promise.all([
      this.runs.findMany({
        where,
        skip: (p - 1) * ps,
        take: ps,
        orderBy: { startedAt: 'desc' },
      }) as Promise<ScheduleRunRow[]>,
      this.runs.count({ where }) as Promise<number>,
    ]);
    return { items: rows.map(toRunEntity), total, page: p, pageSize: ps };
  }

  /** Delete run rows started before `cutoff`. Returns the count removed. */
  async purgeRunsBefore(cutoff: Date): Promise<number> {
    const result = await this.runs.deleteMany({
      where: { startedAt: { lt: cutoff } },
    });
    return result.count;
  }
}

function toEntity(row: ScheduleRow): ScheduleEntity {
  return {
    id: row.id,
    guildId: row.guildId,
    kind: row.kind,
    type: row.type,
    status: row.status,
    payload: row.payload,
    idempotencyKey: row.idempotencyKey,
    cron: row.cron,
    everyMs: row.everyMs,
    timezone: row.timezone,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    deferrable: row.deferrable,
    maxAttempts: row.maxAttempts,
    bullJobId: row.bullJobId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function toRunEntity(row: ScheduleRunRow): ScheduleRunEntity {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    guildId: row.guildId,
    attempt: row.attempt,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    error: row.error,
    traceId: row.traceId,
  };
}
