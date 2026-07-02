import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
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
import { IntegrationSubscriptionRepository } from '../infrastructure/integration-subscription.repository';
import { createIntegrationSubscriptionSchema } from './dto/create-integration-subscription.dto';
import { IntegrationSubscriptionDto } from './dto/notification-response.dto';

interface ScopedRequest extends Request {
  user?: { id: string; guildId?: string | null };
}

/**
 * Integration-subscription surface. All routes are guild-scoped via
 * `req.user.guildId` and gated by `notifications.integrations.*` claims.
 */
@ApiTags('Notification Integrations')
@Controller('api/v1/notifications/integrations')
@UseGuards(RestPermissionGuard)
export class IntegrationsController {
  constructor(private readonly repo: IntegrationSubscriptionRepository) {}

  private requireGuild(req: ScopedRequest): string {
    const guildId = req.user?.guildId;
    if (!guildId) {
      throw new ForbiddenException('integrations are guild-scoped');
    }
    return guildId;
  }

  @Get()
  @RequirePermission(NotificationClaims.IntegrationsRead)
  @ApiOperation({ summary: 'List integration subscriptions for the guild' })
  @ApiOkResponse({ type: [IntegrationSubscriptionDto] })
  async list(@Req() req: ScopedRequest): Promise<IntegrationSubscriptionDto[]> {
    const rows = await this.repo.listForGuild(this.requireGuild(req));
    return rows.map((r) => this.toView(r));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(NotificationClaims.IntegrationsManage)
  @ApiOperation({ summary: 'Subscribe to a Twitch/YouTube/GitHub source' })
  @ApiOkResponse({ type: IntegrationSubscriptionDto })
  async create(
    @Body() body: unknown,
    @Req() req: ScopedRequest,
  ): Promise<IntegrationSubscriptionDto> {
    const guildId = this.requireGuild(req);
    const dto = createIntegrationSubscriptionSchema.parse(body ?? {});
    const record = await this.repo.create({
      guildId,
      provider: dto.provider,
      externalId: dto.externalId,
      announceChannelId: dto.announceChannelId ?? null,
    });
    return this.toView(record);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(NotificationClaims.IntegrationsManage)
  @ApiOperation({ summary: 'Remove an integration subscription' })
  @ApiParam({ name: 'id' })
  async remove(
    @Param('id') id: string,
    @Req() req: ScopedRequest,
  ): Promise<void> {
    const guildId = this.requireGuild(req);
    const record = await this.repo.findById(id);
    if (!record || record.guildId !== guildId) {
      throw new NotFoundException('subscription not found');
    }
    await this.repo.softDelete(id);
  }

  private toView(record: {
    id: string;
    provider: string;
    externalId: string;
    announceChannelId: string | null;
    cursor: string | null;
    active: boolean;
  }): IntegrationSubscriptionDto {
    return {
      id: record.id,
      provider: record.provider,
      externalId: record.externalId,
      announceChannelId: record.announceChannelId,
      cursor: record.cursor,
      active: record.active,
    };
  }
}
