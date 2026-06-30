import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, type DashboardRequest } from '../guards/session.guard';
import { TicketService } from '../gateway/ticket.service';

@ApiTags('dashboard/realtime')
@Controller('api/dashboard/realtime')
@UseGuards(SessionGuard)
export class RealtimeController {
  constructor(private readonly tickets: TicketService) {}

  @Get('ticket')
  @ApiOperation({ summary: 'Issue a short-lived WebSocket ticket' })
  async ticket(@Req() req: DashboardRequest): Promise<{ ticket: string }> {
    const session = req.dashboard!.session;
    const ticket = await this.tickets.issue({
      sessionId: session.sessionId,
      discordId: session.user.discordId,
    });
    return { ticket };
  }
}
