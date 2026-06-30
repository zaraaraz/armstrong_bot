import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, type DashboardRequest } from '../guards/session.guard';
import { GuildManageGuard } from '../guards/guild-manage.guard';
import { ClaimGuard, RequireDashboardClaim } from '../guards/claim.guard';
import { BackupService } from '../services/backup.service';
import { paginationSchema, type PaginationDto } from '../dto/dashboard.dto';
import { dashZod } from '../dto/zod.pipe';

@ApiTags('dashboard/backups')
@Controller('api/dashboard/guilds/:guildId/backups')
@UseGuards(SessionGuard, GuildManageGuard, ClaimGuard)
export class BackupsController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  @RequireDashboardClaim('dashboard.backups.manage')
  @ApiOperation({ summary: 'List backups for a guild' })
  list(
    @Param('guildId') guildId: string,
    @Query(dashZod(paginationSchema)) page: PaginationDto,
  ): Promise<unknown> {
    return this.backups.list(guildId, page.page, page.pageSize);
  }

  @Post()
  @RequireDashboardClaim('dashboard.backups.manage')
  @ApiOperation({ summary: 'Trigger a backup' })
  create(
    @Param('guildId') guildId: string,
    @Req() req: DashboardRequest,
  ): Promise<unknown> {
    return this.backups.request(guildId, req.dashboard!.session.user.discordId);
  }

  @Get(':id')
  @RequireDashboardClaim('dashboard.backups.manage')
  @ApiOperation({ summary: 'Get a single backup' })
  async findOne(
    @Param('guildId') guildId: string,
    @Param('id') id: string,
  ): Promise<unknown> {
    const backup = await this.backups.findOne(guildId, id);
    if (!backup) throw new NotFoundException('Backup not found');
    return backup;
  }
}
