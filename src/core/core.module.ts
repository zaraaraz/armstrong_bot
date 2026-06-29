import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModuleRegistry } from './module-system/module-registry';
import { HealthService } from './health/health.service';
import { HealthController } from './health/health.controller';
import { ShutdownService } from './kernel/shutdown.service';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })],
  controllers: [HealthController],
  providers: [ModuleRegistry, HealthService, ShutdownService],
  exports: [ModuleRegistry, HealthService, ShutdownService],
})
export class CoreModule {}
