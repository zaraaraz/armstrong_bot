import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EventBus } from '../../../core/events/event-bus';
import { SessionGuard, type DashboardRequest } from '../guards/session.guard';
import { GuildManageGuard } from '../guards/guild-manage.guard';
import { ClaimGuard, RequireDashboardClaim } from '../guards/claim.guard';
import { DashboardApiKeyService } from '../services/api-key.service';
import { DashboardAuditRepository } from '../repositories/audit.repository';
import {
  createApiKeySchema,
  paginationSchema,
  type CreateApiKeyDto,
  type PaginationDto,
} from '../dto/dashboard.dto';
import { dashZod } from '../dto/zod.pipe';

@ApiTags('dashboard/api-keys')
@Controller('api/dashboard/guilds/:guildId/api-keys')
@UseGuards(SessionGuard, GuildManageGuard, ClaimGuard)
export class DashboardApiKeysController {
  constructor(
    private readonly apiKeys: DashboardApiKeyService,
    private readonly audit: DashboardAuditRepository,
    @Inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  @Get()
  @RequireDashboardClaim('dashboard.apikeys.manage')
  @ApiOperation({ summary: 'List API keys for a guild' })
  list(
    @Param('guildId') guildId: string,
    @Query(dashZod(paginationSchema)) page: PaginationDto,
  ): Promise<unknown> {
    return this.apiKeys.list(guildId, page.page, page.pageSize);
  }

  @Post()
  @RequireDashboardClaim('dashboard.apikeys.manage')
  @ApiOperation({ summary: 'Create an API key (plaintext shown once)' })
  async create(
    @Param('guildId') guildId: string,
    @Req() req: DashboardRequest,
    @Body(dashZod(createApiKeySchema)) dto: CreateApiKeyDto,
  ): Promise<unknown> {
    const actorId = req.dashboard!.session.user.discordId;
    const created = await this.apiKeys.create(
      guildId,
      dto.name,
      dto.scopes,
      dto.expiresAt ? new Date(dto.expiresAt) : null,
    );
    await this.audit.record({
      guildId,
      actorId,
      action: 'apikey.create',
      target: created.id,
    });
    await this.eventBus.publish(
      'dashboard.apikey.created',
      {
        guildId,
        apiKeyId: created.id,
        actorDiscordId: actorId,
        at: new Date().toISOString(),
      },
      { guildId, actor: { type: 'user', id: actorId } },
    );
    return created;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireDashboardClaim('dashboard.apikeys.manage')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revoke(
    @Param('guildId') guildId: string,
    @Param('id') id: string,
    @Req() req: DashboardRequest,
  ): Promise<void> {
    try {
      await this.apiKeys.revoke(guildId, id);
    } catch {
      throw new NotFoundException('API key not found');
    }
    await this.audit.record({
      guildId,
      actorId: req.dashboard!.session.user.discordId,
      action: 'apikey.revoke',
      target: id,
    });
  }
}
