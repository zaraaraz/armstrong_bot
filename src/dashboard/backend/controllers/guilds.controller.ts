import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, type DashboardRequest } from '../guards/session.guard';
import { GuildManageGuard } from '../guards/guild-manage.guard';
import { DashboardAggregationService } from '../services/dashboard-aggregation.service';
import type { ManageableGuild } from '../interfaces/dashboard.interfaces';

@ApiTags('dashboard/guilds')
@Controller('api/dashboard/guilds')
@UseGuards(SessionGuard)
export class GuildsController {
  constructor(private readonly aggregation: DashboardAggregationService) {}

  @Get()
  @ApiOperation({ summary: 'List guilds the user can manage' })
  list(@Req() req: DashboardRequest): ReadonlyArray<ManageableGuild> {
    const session = req.dashboard!.session;
    if (session.user.isBotOwner) return session.guilds;
    return session.guilds.filter((g) => g.hasManage);
  }

  @Get(':guildId/overview')
  @UseGuards(GuildManageGuard)
  @ApiOperation({ summary: 'Guild overview (counts, recent activity)' })
  overview(@Param('guildId') guildId: string): Promise<unknown> {
    return this.aggregation.overview(guildId);
  }
}
