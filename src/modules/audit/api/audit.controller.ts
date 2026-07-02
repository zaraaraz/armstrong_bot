import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { RestPermissionGuard } from '../../../core/permissions/guards/rest-permission.guard';
import { RequirePermission } from '../../../core/permissions/decorators/require-permission.decorator';
import { AuditClaims } from '../audit.constants';
import {
  AuditActorType,
  AuditScope,
  AuditSource,
} from '../domain/audit-scope.enum';
import type { AuditQuery } from '../domain/audit-entry.model';
import { AuditServiceImpl } from '../application/audit.service';
import { AuditConfigService } from '../config/audit-config.service';
import { AuditQueue } from '../infrastructure/audit.queue';
import { AuditMetrics } from '../observability/audit.metrics';
import {
  auditQuerySchema,
  exportAuditSchema,
  retentionUpdateSchema,
  type AuditQueryDto,
} from '../application/dto/query-audit.dto';
import {
  AuditEntryResponseDto,
  AuditHealthDto,
  ChainVerificationDto,
  PaginatedAuditDto,
  RetentionConfigDto,
} from './dto/audit-response.dto';

interface ScopedRequest extends Request {
  user?: { id: string; guildId?: string | null };
}

/**
 * Read/verify/export surface of the ledger. There is deliberately NO
 * create/update/delete endpoint — entries are born on the Event Bus. All
 * routes are gated by `audit.*` claims and scoped to the caller's guild
 * (null guild => platform operator => GLOBAL scope).
 */
@ApiTags('Audit')
@Controller('api/v1/audit')
@UseGuards(RestPermissionGuard)
export class AuditController {
  constructor(
    private readonly audit: AuditServiceImpl,
    private readonly config: AuditConfigService,
    private readonly queue: AuditQueue,
    private readonly metrics: AuditMetrics,
  ) {}

  private scope(req: ScopedRequest): string | null {
    return req.user?.guildId ?? null;
  }

  private actor(req: ScopedRequest): string {
    return req.user?.id ?? 'unknown';
  }

  @Get('entries')
  @RequirePermission(AuditClaims.Read)
  @ApiOperation({ summary: 'Paginated, filterable audit entries' })
  @ApiOkResponse({ type: PaginatedAuditDto })
  async list(
    @Query() raw: Record<string, string>,
    @Req() req: ScopedRequest,
  ): Promise<PaginatedAuditDto> {
    const dto = auditQuerySchema.parse(raw);
    const guildId = this.scope(req);
    const page = await this.audit.query(this.toQuery(dto, guildId));
    return {
      items: page.items.map((e) => this.audit.toWire(e)),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
    };
  }

  @Get('global')
  @RequirePermission(AuditClaims.ReadGlobal)
  @ApiOperation({ summary: 'GLOBAL-scope (system) audit entries' })
  @ApiOkResponse({ type: PaginatedAuditDto })
  async listGlobal(
    @Query() raw: Record<string, string>,
  ): Promise<PaginatedAuditDto> {
    const dto = auditQuerySchema.parse(raw);
    const page = await this.audit.query({
      ...this.toQuery(dto, null),
      scope: AuditScope.Global,
    });
    return {
      items: page.items.map((e) => this.audit.toWire(e)),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
    };
  }

  @Get('correlations/:correlationId')
  @RequirePermission(AuditClaims.Read)
  @ApiOperation({ summary: 'Full ordered trace of one logical operation' })
  @ApiOkResponse({ type: [AuditEntryResponseDto] })
  @ApiParam({ name: 'correlationId' })
  async trace(
    @Param('correlationId') correlationId: string,
    @Req() req: ScopedRequest,
  ): Promise<AuditEntryResponseDto[]> {
    const guildId = this.scope(req);
    const entries = await this.audit.getByCorrelation(correlationId);
    // never leak another guild's entries through a shared correlation
    const visible = entries.filter(
      (e) => guildId === null || e.guildId === guildId || e.guildId === null,
    );
    return visible.map((e) => this.audit.toWire(e));
  }

  @Get('verify')
  @RequirePermission(AuditClaims.Verify)
  @ApiOperation({ summary: "Verify the caller's hash chain end to end" })
  @ApiOkResponse({ type: ChainVerificationDto })
  async verify(@Req() req: ScopedRequest): Promise<ChainVerificationDto> {
    const guildId = this.scope(req);
    const scope = guildId ? AuditScope.Guild : AuditScope.Global;
    const result = await this.audit.verifyChain(scope, guildId, {
      actorId: this.actor(req),
      source: AuditSource.Api,
    });
    return {
      scope: result.scope,
      guildId: result.guildId,
      checked: result.checked,
      valid: result.valid,
      firstBrokenSeq: result.firstBrokenSeq?.toString() ?? null,
      verifiedAt: result.verifiedAt.toISOString(),
    };
  }

  @Post('export')
  @RequirePermission(AuditClaims.Export)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stream entries as json/ndjson/csv' })
  @ApiProduces('application/json', 'application/x-ndjson', 'text/csv')
  async export(
    @Body() body: unknown,
    @Req() req: ScopedRequest,
  ): Promise<StreamableFile> {
    const dto = exportAuditSchema.parse(body ?? {});
    const guildId = this.scope(req);
    const stream = await this.audit.export(
      this.toQuery({ ...dto, page: 1, pageSize: 1 }, guildId),
      dto.format,
      { actorId: this.actor(req), source: AuditSource.Api },
    );
    const stamp = new Date().toISOString().slice(0, 10);
    return new StreamableFile(stream as Readable, {
      type:
        dto.format === 'csv'
          ? 'text/csv'
          : dto.format === 'ndjson'
            ? 'application/x-ndjson'
            : 'application/json',
      disposition: `attachment; filename="audit-${stamp}.${dto.format}"`,
    });
  }

  @Get('retention')
  @RequirePermission(AuditClaims.RetentionManage)
  @ApiOperation({ summary: "Caller guild's retention policy" })
  @ApiOkResponse({ type: RetentionConfigDto })
  async retention(@Req() req: ScopedRequest): Promise<RetentionConfigDto> {
    const cfg = await this.config.forGuild(this.scope(req));
    return {
      retentionDays: cfg.retentionDays,
      archiveBeforeDelete: cfg.archiveBeforeDelete,
      archiveFormat: cfg.archiveFormat,
    };
  }

  @Put('retention')
  @RequirePermission(AuditClaims.RetentionManage)
  @ApiOperation({ summary: 'Update the guild retention policy' })
  @ApiOkResponse({ type: RetentionConfigDto })
  async updateRetention(
    @Body() body: unknown,
    @Req() req: ScopedRequest,
  ): Promise<RetentionConfigDto> {
    const guildId = this.scope(req);
    if (!guildId) {
      throw new BadRequestException(
        'retention policy is guild-scoped; global retention is ENV-managed',
      );
    }
    const patch = retentionUpdateSchema.parse(body ?? {});
    const cfg = await this.config.updateGuild(guildId, patch);
    await this.audit.record({
      scope: AuditScope.Guild,
      guildId,
      action: 'audit.retention.updated',
      source: AuditSource.Api,
      actorId: this.actor(req),
      actorType: AuditActorType.User,
      targetType: 'config',
      targetId: guildId,
      channelId: null,
      correlationId: randomUUID(),
      causationId: null,
      summary: 'audit:actions.audit.retention.updated',
      metadata: { patch: { ...patch } },
      before: null,
      after: { ...patch },
      occurredAt: new Date(),
    });
    return {
      retentionDays: cfg.retentionDays,
      archiveBeforeDelete: cfg.archiveBeforeDelete,
      archiveFormat: cfg.archiveFormat,
    };
  }

  @Get('health')
  @RequirePermission(AuditClaims.Read)
  @ApiOperation({ summary: 'Ingest queue depth and DLQ size' })
  @ApiOkResponse({ type: AuditHealthDto })
  async health(): Promise<AuditHealthDto> {
    const [queueDepth, dlqSize] = await Promise.all([
      this.queue.depth(),
      this.queue.failedCount(),
    ]);
    this.metrics.setQueueDepth(queueDepth);
    return {
      queueDepth,
      dlqSize,
      ingestEnabled: this.config.global().ingestEnabled,
    };
  }

  private toQuery(dto: AuditQueryDto, guildId: string | null): AuditQuery {
    return {
      guildId: guildId ?? undefined,
      scope: guildId ? AuditScope.Guild : dto.scope,
      actorId: dto.actorId,
      action: dto.action,
      targetType: dto.targetType,
      targetId: dto.targetId,
      correlationId: dto.correlationId,
      source: dto.source,
      from: dto.from,
      to: dto.to,
      pagination: { page: dto.page, pageSize: dto.pageSize },
    };
  }
}
