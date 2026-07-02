import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
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
import { NotificationClaims } from '../notifications.constants';
import { NotificationService } from '../application/notification.service';
import { NotificationRepository } from '../infrastructure/notification.repository';
import { NotificationQueues } from '../jobs/queues';
import { ProviderRegistry } from '../providers/provider.registry';
import { NotificationsMetrics } from '../observability/notifications.metrics';
import { dispatchNotificationSchema } from './dto/dispatch-notification.dto';
import { notificationsListQuerySchema } from './dto/update-preference.dto';
import {
  DispatchResultDto,
  NotificationResponseDto,
  NotificationsHealthDto,
  PaginatedNotificationsDto,
} from './dto/notification-response.dto';
import type {
  DeliveryRecord,
  NotificationRecord,
} from '../domain/notification.model';

interface ScopedRequest extends Request {
  user?: { id: string; guildId?: string | null };
}

/**
 * Dispatch / read / cancel surface. All routes are gated by `notifications.*`
 * claims and scoped to the caller's guild via `req.user.guildId` (the
 * scheduler/audit precedent, not the spec's `/guilds/:guildId` path — recorded
 * as an as-built delta). A null guild => platform operator => global scope.
 */
@ApiTags('Notifications')
@Controller('api/v1/notifications')
@UseGuards(RestPermissionGuard)
export class NotificationsController {
  constructor(
    private readonly service: NotificationService,
    private readonly repo: NotificationRepository,
    private readonly queues: NotificationQueues,
    private readonly providers: ProviderRegistry,
    private readonly metrics: NotificationsMetrics,
  ) {}

  private scope(req: ScopedRequest): string | null {
    return req.user?.guildId ?? null;
  }

  @Get('health')
  @RequirePermission(NotificationClaims.Read)
  @ApiOperation({ summary: 'Delivery queue depth, DLQ size, provider health' })
  @ApiOkResponse({ type: NotificationsHealthDto })
  async health(): Promise<NotificationsHealthDto> {
    const [deliveryQueueDepth, dlqSize] = await Promise.all([
      this.queues.deliveryDepth(),
      this.queues.dlqSize(),
    ]);
    this.metrics.setQueueDepth(deliveryQueueDepth);
    const providers = await Promise.all(
      this.providers.all().map(async (p) => {
        const probe = await p.healthCheck().catch(() => ({ healthy: false }));
        this.metrics.setProviderHealth(p.channel, probe.healthy);
        return {
          channel: p.channel,
          healthy: probe.healthy,
          detail: 'detail' in probe ? probe.detail : undefined,
        };
      }),
    );
    return { deliveryQueueDepth, dlqSize, providers };
  }

  @Get('dlq')
  @RequirePermission(NotificationClaims.Read)
  @ApiOperation({ summary: 'Failed / dead-lettered deliveries (paginated)' })
  async dlq(
    @Query() raw: Record<string, string>,
    @Req() req: ScopedRequest,
  ): Promise<PaginatedNotificationsDto> {
    const q = notificationsListQuerySchema.parse(raw);
    const page = await this.repo.listFailed(
      this.scope(req),
      q.page,
      q.pageSize,
    );
    return {
      items: page.items.map((d) => this.deliveryOnlyView(d)),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
    };
  }

  @Get()
  @RequirePermission(NotificationClaims.Read)
  @ApiOperation({
    summary: 'List notifications with delivery status (paginated)',
  })
  @ApiOkResponse({ type: PaginatedNotificationsDto })
  async list(
    @Query() raw: Record<string, string>,
    @Req() req: ScopedRequest,
  ): Promise<PaginatedNotificationsDto> {
    const q = notificationsListQuerySchema.parse(raw);
    const page = await this.repo.list({
      guildId: this.scope(req),
      category: q.category,
      pagination: { page: q.page, pageSize: q.pageSize },
    });
    return {
      items: page.items.map((n) => this.toView(n)),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
    };
  }

  @Get(':id')
  @RequirePermission(NotificationClaims.Read)
  @ApiOperation({ summary: 'Get one notification with delivery status' })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiParam({ name: 'id' })
  async getOne(
    @Param('id') id: string,
    @Req() req: ScopedRequest,
  ): Promise<NotificationResponseDto> {
    const record = await this.repo.findById(id);
    if (!record || !this.visible(record, this.scope(req))) {
      throw new NotFoundException('notification not found');
    }
    return this.toView(record);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(NotificationClaims.Dispatch)
  @ApiOperation({ summary: 'Dispatch an ad-hoc notification' })
  @ApiOkResponse({ type: DispatchResultDto })
  async dispatch(
    @Body() body: unknown,
    @Req() req: ScopedRequest,
  ): Promise<DispatchResultDto> {
    const dto = dispatchNotificationSchema.parse(body ?? {});
    const result = await this.service.dispatch({
      guildId: this.scope(req),
      category: dto.category,
      priority: dto.priority,
      templateKey: dto.templateKey,
      vars: dto.vars,
      recipients: dto.recipients,
      channels: dto.channels,
      dedupeKey: dto.dedupeKey,
      localeOverride: dto.localeOverride,
    });
    return {
      notificationId: result.notificationId,
      enqueuedDeliveries: result.enqueuedDeliveries,
      skipped: result.skipped.map((s) => ({
        channel: s.channel,
        reason: s.reason,
      })),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(NotificationClaims.Cancel)
  @ApiOperation({ summary: "Cancel a notification's pending deliveries" })
  @ApiParam({ name: 'id' })
  async cancel(
    @Param('id') id: string,
    @Req() req: ScopedRequest,
  ): Promise<void> {
    const record = await this.repo.findById(id);
    if (!record || !this.visible(record, this.scope(req))) {
      throw new NotFoundException('notification not found');
    }
    await this.service.cancelPending(id);
  }

  private toView(record: NotificationRecord): NotificationResponseDto {
    return {
      id: record.id,
      guildId: record.guildId,
      category: record.category,
      priority: record.priority,
      templateKey: record.templateKey,
      vars: { ...record.vars },
      dedupeKey: record.dedupeKey,
      createdAt: record.createdAt.toISOString(),
      deliveries: record.deliveries.map((d) => ({
        id: d.id,
        channel: d.channel,
        status: d.status,
        recipientUserId: d.recipientUserId,
        recipientRef: d.recipientRef,
        providerMessageId: d.providerMessageId,
        attempts: d.attempts,
        lastError: d.lastError,
        deliveredAt: d.deliveredAt?.toISOString() ?? null,
      })),
    };
  }

  private deliveryOnlyView(d: DeliveryRecord): NotificationResponseDto {
    return {
      id: d.notificationId,
      guildId: null,
      category: '',
      priority: '',
      templateKey: '',
      vars: {},
      dedupeKey: null,
      createdAt: d.createdAt.toISOString(),
      deliveries: [
        {
          id: d.id,
          channel: d.channel,
          status: d.status,
          recipientUserId: d.recipientUserId,
          recipientRef: d.recipientRef,
          providerMessageId: d.providerMessageId,
          attempts: d.attempts,
          lastError: d.lastError,
          deliveredAt: d.deliveredAt?.toISOString() ?? null,
        },
      ],
    };
  }

  private visible(record: NotificationRecord, guildId: string | null): boolean {
    return guildId === null || record.guildId === guildId;
  }
}
