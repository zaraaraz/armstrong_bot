import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { RestPermissionGuard } from '../../../core/permissions/guards/rest-permission.guard';
import { RequirePermission } from '../../../core/permissions/decorators/require-permission.decorator';
import { MetricsClaims } from '../metrics.constants';
import { MetricsSnapshotService } from '../application/metrics.service.contract';
import { ThresholdEvaluatorService } from '../application/threshold-evaluator.service';
import { MetricsThresholdRepository } from '../infrastructure/repositories/metrics-threshold.repository';
import { MetricsConfigService } from '../config/metrics-config.service';
import { fromDbScope, isMetricScope } from '../domain/metric-scope';
import {
  metricsRangeQuerySchema,
  upsertThresholdSchema,
} from '../dto/metrics-query.dto';
import {
  MetricsSnapshotDto,
  PaginatedSnapshotDto,
  ThresholdDto,
} from '../dto/metrics-snapshot.dto';

interface ScopedRequest extends Request {
  user?: { id: string; guildId?: string | null };
}

/**
 * Dashboard read/manage surface for metrics rollups and alerting thresholds.
 * Swagger-documented and permission-guarded (`metrics.view` / `metrics.manage`).
 * Scoped to the caller's guild; a null guild (platform operator) sees global.
 */
@ApiTags('Metrics')
@Controller('api/v1/metrics')
@UseGuards(RestPermissionGuard)
export class MetricsAdminController {
  constructor(
    private readonly snapshots: MetricsSnapshotService,
    private readonly thresholds: ThresholdEvaluatorService,
    private readonly thresholdRepo: MetricsThresholdRepository,
    private readonly config: MetricsConfigService,
  ) {}

  private guild(req: ScopedRequest): string | null {
    return req.user?.guildId ?? null;
  }

  @Get('snapshots/:scope/latest')
  @RequirePermission(MetricsClaims.View)
  @ApiOperation({ summary: 'Latest rollup for a scope (cached)' })
  @ApiParam({ name: 'scope' })
  @ApiOkResponse({ type: MetricsSnapshotDto })
  async latest(
    @Param('scope') scope: string,
    @Req() req: ScopedRequest,
  ): Promise<MetricsSnapshotDto> {
    const view = await this.snapshots.latest(
      this.assertScope(scope),
      this.guild(req),
    );
    if (!view) throw new NotFoundException('no snapshot for scope');
    return {
      id: view.id,
      scope: view.scope,
      guildId: view.guildId,
      capturedAt: view.capturedAt.toISOString(),
      values: { ...view.values },
    };
  }

  @Get('snapshots/:scope')
  @RequirePermission(MetricsClaims.View)
  @ApiOperation({ summary: 'Paginated rollups over a time range' })
  @ApiParam({ name: 'scope' })
  @ApiOkResponse({ type: PaginatedSnapshotDto })
  async range(
    @Param('scope') scope: string,
    @Query() raw: Record<string, string>,
    @Req() req: ScopedRequest,
  ): Promise<PaginatedSnapshotDto> {
    const dto = metricsRangeQuerySchema.parse(raw);
    const page = await this.snapshots.range({
      scope: this.assertScope(scope),
      guildId: dto.guildId ?? this.guild(req),
      from: dto.from,
      to: dto.to,
      page: dto.page,
      pageSize: dto.pageSize,
    });
    return {
      items: page.items.map((v) => ({
        id: v.id,
        scope: v.scope,
        guildId: v.guildId,
        capturedAt: v.capturedAt.toISOString(),
        values: { ...v.values },
      })),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
    };
  }

  @Get('thresholds')
  @RequirePermission(MetricsClaims.View)
  @ApiOperation({
    summary: 'Effective thresholds (defaults + guild overrides)',
  })
  @ApiOkResponse({ type: [ThresholdDto] })
  async listThresholds(@Req() req: ScopedRequest): Promise<ThresholdDto[]> {
    const effective = await this.thresholds.allEffective(this.guild(req));
    return effective.map((t) => ({
      metric: t.metric,
      comparator: t.comparator,
      value: t.value,
      severity: t.severity,
      source: t.source,
    }));
  }

  @Put('thresholds/:metric')
  @RequirePermission(MetricsClaims.Manage)
  @ApiOperation({ summary: 'Create/update a guild threshold override' })
  @ApiParam({ name: 'metric' })
  @ApiOkResponse({ type: ThresholdDto })
  async upsertThreshold(
    @Param('metric') metric: string,
    @Body() body: unknown,
    @Req() req: ScopedRequest,
  ): Promise<ThresholdDto> {
    const guildId = this.guild(req);
    if (!guildId) {
      throw new NotFoundException(
        'threshold overrides are guild-scoped; global thresholds are ENV-managed',
      );
    }
    const dto = upsertThresholdSchema.parse(body ?? {});
    const saved = await this.thresholdRepo.upsert({
      guildId,
      metric,
      comparator: dto.comparator,
      value: dto.value,
      severity: dto.severity,
      enabled: dto.enabled,
    });
    await this.config.invalidateGuild(guildId);
    return {
      metric: saved.metric,
      comparator: saved.comparator,
      value: saved.value,
      severity: saved.severity,
      source: 'override',
    };
  }

  private assertScope(scope: string) {
    if (!isMetricScope(scope)) {
      throw new NotFoundException(`unknown metric scope: ${scope}`);
    }
    return fromDbScope(scope);
  }
}
