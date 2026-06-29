import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  EventLogRepository,
  type EventLogRecord,
} from '../repositories/event-log.repository';
import {
  DeadLetterRepository,
  type DeadLetterRecord,
} from '../repositories/dead-letter.repository';
import { EventReplayService } from '../replay/event-replay.service';
import { listEventsQuerySchema } from '../dto/list-events-query.dto';
import { replayRequestSchema } from '../dto/replay-request.dto';
import type { EventLogResponseDto } from '../dto/event-log.dto';
import type { DeadLetterResponseDto } from '../dto/dead-letter.dto';

@ApiTags('Events')
@Controller('api/v1/events')
export class EventsController {
  constructor(
    private readonly eventLog: EventLogRepository,
    private readonly deadLetter: DeadLetterRepository,
    private readonly replay: EventReplayService,
  ) {}

  @Get('logs')
  @ApiOperation({ summary: 'Paginated event log' })
  async listLogs(@Query() raw: Record<string, string>) {
    const query = listEventsQuerySchema.parse(raw);
    const { items, total } = await this.eventLog.list(query);
    return {
      data: items.map((r) => this.mapLog(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  @Get('logs/:envelopeId')
  @ApiOperation({ summary: 'Single envelope detail' })
  async getLog(
    @Param('envelopeId') envelopeId: string,
  ): Promise<EventLogResponseDto> {
    const record = await this.eventLog.findByEnvelopeId(envelopeId);
    if (!record)
      throw new NotFoundException(`EventLog ${envelopeId} not found`);
    return this.mapLog(record);
  }

  @Get('dead-letters')
  @ApiOperation({ summary: 'Paginated DLQ listing' })
  async listDeadLetters(@Query() raw: Record<string, string>) {
    const page = Math.max(1, Number(raw['page'] ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(raw['pageSize'] ?? 25)));
    const { items, total } = await this.deadLetter.list({
      eventName: raw['eventName'],
      handlerId: raw['handlerId'],
      status: raw['status'],
      guildId: raw['guildId'],
      page,
      pageSize,
    });
    return {
      data: items.map((r) => this.mapDeadLetter(r)),
      total,
      page,
      pageSize,
    };
  }

  @Post('dead-letters/:id/replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replay one DLQ entry' })
  async replayDeadLetter(@Param('id') id: string) {
    try {
      await this.replay.replayDeadLetter(id, 'api');
      return { ok: true };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Post('dead-letters/:id/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Discard a DLQ entry' })
  async discardDeadLetter(@Param('id') id: string) {
    try {
      await this.replay.discardDeadLetter(id);
      return { ok: true };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Post('replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk replay persisted events by filter' })
  async replayBulk(@Body() body: Record<string, unknown>) {
    const dto = replayRequestSchema.parse(body);
    const result = await this.replay.replayByFilter(
      {
        eventName: dto.eventName,
        guildId: dto.guildId,
        correlationId: dto.correlationId,
        from: dto.from ? new Date(dto.from) : undefined,
        to: dto.to ? new Date(dto.to) : undefined,
        limit: dto.limit,
      },
      'api',
    );
    return result;
  }

  private mapLog(r: EventLogRecord): EventLogResponseDto {
    return {
      id: r.id,
      envelopeId: r.envelopeId,
      eventName: r.eventName,
      guildId: r.guildId,
      actorType: r.actorType,
      actorId: r.actorId,
      correlationId: r.correlationId,
      causationId: r.causationId,
      version: r.version,
      delivery: r.delivery,
      status: r.status,
      occurredAt: r.occurredAt.toISOString(),
    };
  }

  private mapDeadLetter(r: DeadLetterRecord): DeadLetterResponseDto {
    return {
      id: r.id,
      envelopeId: r.envelopeId,
      eventName: r.eventName,
      guildId: r.guildId,
      handlerId: r.handlerId,
      attempts: r.attempts,
      errorCode: r.errorCode,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
