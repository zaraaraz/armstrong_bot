import { Injectable, NotFoundException } from '@nestjs/common';
import { ScheduleRepository } from '../infrastructure/schedule.repository';
import { SchedulerQueue } from '../infrastructure/scheduler.queue';
import { SchedulerHealthState } from './scheduler-health.state';
import { SchedulerMetrics } from '../observability/scheduler.metrics';
import type { JobQueryDto, RunQueryDto } from './dto/job-query.dto';
import type {
  ScheduleEntity,
  ScheduleRunEntity,
} from '../domain/schedule.entity';
import type {
  HealthResponseDto,
  JobResponseDto,
  PaginatedJobsDto,
  PaginatedRunsDto,
  RunResponseDto,
} from '../api/dto/job-response.dto';

/**
 * Read-side service powering the dashboard/admin API. Maps domain entities to
 * response DTOs and computes the health snapshot. Guild scoping is enforced by
 * the caller passing a `scopeGuildId` (null = platform/global view).
 */
@Injectable()
export class SchedulerQueryService {
  constructor(
    private readonly repo: ScheduleRepository,
    private readonly queue: SchedulerQueue,
    private readonly healthState: SchedulerHealthState,
    private readonly metrics: SchedulerMetrics,
  ) {}

  async listJobs(
    query: JobQueryDto,
    scopeGuildId: string | null | undefined,
  ): Promise<PaginatedJobsDto> {
    // A guild-scoped caller may only see its own guild's jobs.
    const guildId = scopeGuildId !== undefined ? scopeGuildId : query.guildId;
    const result = await this.repo.list({
      guildId,
      kind: query.kind,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: result.items.map(toJobDto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async getJob(
    id: string,
    scopeGuildId: string | null | undefined,
  ): Promise<JobResponseDto> {
    const entity = await this.repo.findById(id, scopeGuildId);
    if (!entity) throw new NotFoundException(`Schedule ${id} not found`);
    return toJobDto(entity);
  }

  async listRuns(
    id: string,
    query: RunQueryDto,
    scopeGuildId: string | null | undefined,
  ): Promise<PaginatedRunsDto> {
    // Confirm the job is visible to this scope before returning its runs.
    const entity = await this.repo.findById(id, scopeGuildId);
    if (!entity) throw new NotFoundException(`Schedule ${id} not found`);
    const result = await this.repo.listRuns(id, query.page, query.pageSize);
    return {
      items: result.items.map(toRunDto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async health(): Promise<HealthResponseDto> {
    const [queueDepth, dlqSize] = await Promise.all([
      this.queue.depth(),
      this.repo.countByStatus('failed'),
    ]);
    this.metrics.setQueueDepth(queueDepth);
    this.metrics.setDlqSize(dlqSize);
    const snapshot = this.healthState.snapshot();
    return {
      queueDepth,
      dlqSize,
      lastReconcileAt: snapshot.lastReconcileAt?.toISOString() ?? null,
      workerUp: snapshot.workerUp,
    };
  }
}

function toJobDto(e: ScheduleEntity): JobResponseDto {
  return {
    id: e.id,
    kind: e.kind,
    guildId: e.guildId,
    type: e.type,
    status: e.status,
    cron: e.cron,
    everyMs: e.everyMs,
    nextRunAt: e.nextRunAt?.toISOString() ?? null,
    lastRunAt: e.lastRunAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

function toRunDto(r: ScheduleRunEntity): RunResponseDto {
  return {
    id: r.id,
    attempt: r.attempt,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    error: r.error,
  };
}
