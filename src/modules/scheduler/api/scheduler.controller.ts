import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { RestPermissionGuard } from '../../../core/permissions/guards/rest-permission.guard';
import { RequirePermission } from '../../../core/permissions/decorators/require-permission.decorator';
import { SchedulerService } from '../application/scheduler.service.contract';
import { SchedulerQueryService } from '../application/scheduler-query.service';
import { SchedulerAuditService } from '../observability/scheduler.audit';
import {
  jobQuerySchema,
  runQuerySchema,
} from '../application/dto/job-query.dto';
import {
  HealthResponseDto,
  JobResponseDto,
  PaginatedJobsDto,
  PaginatedRunsDto,
} from './dto/job-response.dto';

interface ScopedRequest extends Request {
  user?: { id: string; guildId?: string | null };
}

/**
 * REST surface for the dashboard/admin. Every control endpoint is gated by a
 * `scheduler.*` claim via {@link RestPermissionGuard} and scoped to the caller's
 * guild — a guild admin can only act on its own guild's jobs; global/system jobs
 * require a platform-level claim with no guild constraint.
 */
@ApiTags('Scheduler')
@Controller('api/v1/scheduler')
@UseGuards(RestPermissionGuard)
export class SchedulerController {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly query: SchedulerQueryService,
    private readonly audit: SchedulerAuditService,
  ) {}

  /** The guild a caller is scoped to (null => platform/global). */
  private scope(req: ScopedRequest): string | null {
    return req.user?.guildId ?? null;
  }

  private actor(req: ScopedRequest): string {
    return req.user?.id ?? 'unknown';
  }

  @Get('jobs')
  @RequirePermission('scheduler.view')
  @ApiOperation({ summary: 'Paginated list of schedules' })
  @ApiOkResponse({ type: PaginatedJobsDto })
  listJobs(
    @Query() raw: Record<string, string>,
    @Req() req: ScopedRequest,
  ): Promise<PaginatedJobsDto> {
    const q = jobQuerySchema.parse(raw);
    return this.query.listJobs(q, this.scope(req));
  }

  @Get('jobs/:id')
  @RequirePermission('scheduler.view')
  @ApiOperation({ summary: 'Job detail' })
  @ApiOkResponse({ type: JobResponseDto })
  @ApiParam({ name: 'id' })
  getJob(
    @Param('id') id: string,
    @Req() req: ScopedRequest,
  ): Promise<JobResponseDto> {
    return this.query.getJob(id, this.scope(req));
  }

  @Get('jobs/:id/runs')
  @RequirePermission('scheduler.view')
  @ApiOperation({ summary: 'Paginated run history for a job' })
  @ApiOkResponse({ type: PaginatedRunsDto })
  listRuns(
    @Param('id') id: string,
    @Query() raw: Record<string, string>,
    @Req() req: ScopedRequest,
  ): Promise<PaginatedRunsDto> {
    const q = runQuerySchema.parse(raw);
    return this.query.listRuns(id, q, this.scope(req));
  }

  @Post('jobs/:id/pause')
  @RequirePermission('scheduler.pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause an active recurring job' })
  async pause(
    @Param('id') id: string,
    @Req() req: ScopedRequest,
  ): Promise<{ ok: boolean }> {
    const ok = await this.scheduler.pause(id, this.scope(req));
    this.audit.record({
      actor: this.actor(req),
      guildId: this.scope(req),
      action: 'scheduler.pause',
      jobId: id,
      after: 'paused',
    });
    return { ok };
  }

  @Post('jobs/:id/resume')
  @RequirePermission('scheduler.pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a paused job' })
  async resume(
    @Param('id') id: string,
    @Req() req: ScopedRequest,
  ): Promise<{ ok: boolean }> {
    const ok = await this.scheduler.resume(id, this.scope(req));
    this.audit.record({
      actor: this.actor(req),
      guildId: this.scope(req),
      action: 'scheduler.resume',
      jobId: id,
      after: 'active',
    });
    return { ok };
  }

  @Post('jobs/:id/trigger')
  @RequirePermission('scheduler.trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger an execution now' })
  async trigger(
    @Param('id') id: string,
    @Req() req: ScopedRequest,
  ): Promise<{ ok: boolean }> {
    await this.scheduler.triggerNow(id, this.scope(req));
    this.audit.record({
      actor: this.actor(req),
      guildId: this.scope(req),
      action: 'scheduler.trigger',
      jobId: id,
    });
    return { ok: true };
  }

  @Delete('jobs/:id')
  @RequirePermission('scheduler.cancel')
  @ApiOperation({ summary: 'Cancel (soft-delete) a job' })
  async cancel(
    @Param('id') id: string,
    @Req() req: ScopedRequest,
  ): Promise<{ ok: boolean }> {
    const ok = await this.scheduler.cancel(id, this.scope(req));
    this.audit.record({
      actor: this.actor(req),
      guildId: this.scope(req),
      action: 'scheduler.cancel',
      jobId: id,
      after: 'cancelled',
    });
    return { ok };
  }

  @Get('health')
  @RequirePermission('scheduler.view')
  @ApiOperation({
    summary: 'Queue depth, DLQ size, last reconcile, worker status',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  health(): Promise<HealthResponseDto> {
    return this.query.health();
  }
}
