import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
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
import { NotificationClaims } from '../notifications.constants';
import { PermissionService } from '../../../core/permissions/application/permission.service';
import { NotificationPreferenceRepository } from '../infrastructure/notification-preference.repository';
import { PreferenceResolver } from '../domain/preference-resolver.service';
import { updatePreferencesSchema } from './dto/update-preference.dto';
import { MergedPreferencesDto } from './dto/notification-response.dto';

interface ScopedRequest extends Request {
  user?: {
    id: string;
    guildId?: string | null;
    roleIds?: string[];
    isGuildOwner?: boolean;
  };
}

/**
 * Preference-center surface. Reading/managing another user's preferences needs
 * the `prefs.read` / `prefs.manage` claim; a user may always read and manage
 * their OWN preferences without those claims (self-scope check per section 11).
 */
@ApiTags('Notification Preferences')
@Controller('api/v1/notifications/preferences')
@UseGuards(RestPermissionGuard)
export class PreferencesController {
  constructor(
    private readonly repo: NotificationPreferenceRepository,
    private readonly resolver: PreferenceResolver,
    private readonly permissions: PermissionService,
  ) {}

  @Get(':userId')
  @ApiOperation({ summary: 'Read merged preferences for a user' })
  @ApiOkResponse({ type: MergedPreferencesDto })
  @ApiParam({ name: 'userId' })
  async read(
    @Param('userId') userId: string,
    @Req() req: ScopedRequest,
  ): Promise<MergedPreferencesDto> {
    const guildId = this.requireGuild(req);
    await this.authorize(req, guildId, userId, NotificationClaims.PrefsRead);
    const rows = await this.repo.findForUser(guildId, userId);
    return {
      guildId,
      userId,
      preferences: rows.map((r) => ({
        category: r.category,
        channel: r.channel,
        enabled: r.enabled,
      })),
    };
  }

  @Put(':userId')
  @ApiOperation({ summary: "Upsert a user's category × channel preferences" })
  @ApiOkResponse({ type: MergedPreferencesDto })
  @ApiParam({ name: 'userId' })
  async update(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() req: ScopedRequest,
  ): Promise<MergedPreferencesDto> {
    const guildId = this.requireGuild(req);
    await this.authorize(req, guildId, userId, NotificationClaims.PrefsManage);
    const dto = updatePreferencesSchema.parse(body ?? {});
    await this.repo.upsertMany(
      dto.preferences.map((p) => ({
        guildId,
        userId,
        category: p.category,
        channel: p.channel,
        enabled: p.enabled,
      })),
    );
    await this.resolver.invalidateUser(guildId, userId);
    const rows = await this.repo.findForUser(guildId, userId);
    return {
      guildId,
      userId,
      preferences: rows.map((r) => ({
        category: r.category,
        channel: r.channel,
        enabled: r.enabled,
      })),
    };
  }

  private requireGuild(req: ScopedRequest): string {
    const guildId = req.user?.guildId;
    if (!guildId) {
      throw new ForbiddenException('preferences are guild-scoped');
    }
    return guildId;
  }

  /**
   * Self-scope bypass: a caller acting on their own preferences is always
   * allowed. Otherwise the claim is required.
   */
  private async authorize(
    req: ScopedRequest,
    guildId: string,
    targetUserId: string,
    claim: string,
  ): Promise<void> {
    if (req.user?.id === targetUserId) return;
    await this.permissions.assert(
      {
        userId: req.user?.id ?? 'unknown',
        guildId,
        discordRoleIds: req.user?.roleIds ?? [],
        isGuildOwner: req.user?.isGuildOwner ?? false,
      },
      claim,
    );
  }
}
