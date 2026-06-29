import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus';
import { EventBusService } from './event-bus.service';
import { SyncDispatcher } from './dispatchers/sync.dispatcher';
import { AsyncDispatcher } from './dispatchers/async.dispatcher';
import { IdempotencyGuard } from './idempotency/idempotency.guard';
import { EventLogRepository } from './repositories/event-log.repository';
import { PrismaEventLogRepository } from './repositories/event-log.prisma.repository';
import { DeadLetterRepository } from './repositories/dead-letter.repository';
import { PrismaDeadLetterRepository } from './repositories/dead-letter.prisma.repository';
import { DiscordBridgeService } from './discord/discord-bridge.service';
import { EventReplayService } from './replay/event-replay.service';
import { EventsController } from './api/events.controller';

@Global()
@Module({
  controllers: [EventsController],
  providers: [
    { provide: EventBus, useClass: EventBusService },
    SyncDispatcher,
    AsyncDispatcher,
    IdempotencyGuard,
    { provide: EventLogRepository, useClass: PrismaEventLogRepository },
    { provide: DeadLetterRepository, useClass: PrismaDeadLetterRepository },
    DiscordBridgeService,
    EventReplayService,
  ],
  exports: [EventBus, DiscordBridgeService, EventReplayService],
})
export class EventBusModule {}
