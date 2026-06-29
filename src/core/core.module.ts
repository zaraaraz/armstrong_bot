import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InProcessEventBus } from './events/in-process-event-bus';
import { EventBus } from './events/event-bus';
import { ModuleRegistry } from './module-system/module-registry';
import { HealthService } from './health/health.service';
import { HealthController } from './health/health.controller';
import { ShutdownService } from './kernel/shutdown.service';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })],
  controllers: [HealthController],
  providers: [
    { provide: EventBus, useClass: InProcessEventBus },
    ModuleRegistry,
    HealthService,
    ShutdownService,
  ],
  exports: [EventBus, ModuleRegistry, HealthService, ShutdownService],
})
export class CoreModule {}
