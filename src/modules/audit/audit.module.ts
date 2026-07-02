import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditController } from './api/audit.controller';
import { AuditPublicApi } from './application/audit.service.contract';
import { AuditServiceImpl } from './application/audit.service';
import { AuditIngestService } from './application/audit-ingest.service';
import { AuditConfigService } from './config/audit-config.service';
import { AuditChainService } from './domain/audit-chain.service';
import { RetentionService } from './domain/retention.service';
import { AuditRepository } from './infrastructure/audit.repository';
import { AuditQueue } from './infrastructure/audit.queue';
import { AuditArchiveStore } from './infrastructure/audit-archive.store';
import { AuditExportWriter } from './infrastructure/audit-export.writer';
import { AuditEventConsumer } from './events/audit-event.consumer';
import { AuditEventEmitter } from './events/audit-event.emitter';
import { AuditIngestProcessor } from './jobs/audit-ingest.processor';
import { AuditMetrics } from './observability/audit.metrics';
import { AuditTracing } from './observability/audit.tracing';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [AuditController],
  providers: [
    // Config
    AuditConfigService,
    // Domain
    AuditChainService,
    RetentionService,
    // Infrastructure
    AuditRepository,
    AuditQueue,
    AuditArchiveStore,
    AuditExportWriter,
    // Application
    AuditIngestService,
    { provide: AuditPublicApi, useClass: AuditServiceImpl },
    { provide: AuditServiceImpl, useExisting: AuditPublicApi },
    // Events
    AuditEventConsumer,
    AuditEventEmitter,
    // Jobs
    AuditIngestProcessor,
    // Observability
    AuditMetrics,
    AuditTracing,
  ],
  exports: [AuditPublicApi],
})
export class AuditModule {}
