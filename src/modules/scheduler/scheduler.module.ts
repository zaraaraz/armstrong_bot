import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// Config
import { SchedulerConfigService } from './config/scheduler-config.service';
// Domain
import { SchedulerDomainService } from './domain/scheduler.domain-service';
import { JobRegistry, InMemoryJobRegistry } from './domain/job-registry';
// Infrastructure
import { ScheduleRepository } from './infrastructure/schedule.repository';
import { SchedulerQueue } from './infrastructure/scheduler.queue';
import { SchedulerWorker } from './infrastructure/scheduler.worker';
// Application
import { SchedulerService } from './application/scheduler.service.contract';
import { SchedulerServiceImpl } from './application/scheduler.service';
import { SchedulerQueryService } from './application/scheduler-query.service';
import { SchedulerLifecycleEmitter } from './application/lifecycle.emitter';
import { ScheduleReconciler } from './application/schedule.reconciler';
import { MaintenanceHandler } from './application/maintenance.handler';
import { CleanupJob } from './application/cleanup.job';
import { SchedulerHealthState } from './application/scheduler-health.state';
// Observability
import { SchedulerMetrics } from './observability/scheduler.metrics';
import { SchedulerTracing } from './observability/scheduler.tracing';
import { SchedulerAuditService } from './observability/scheduler.audit';
// API
import { SchedulerController } from './api/scheduler.controller';

/**
 * The Scheduler module — a thin domain layer over BullMQ. Exposes the public
 * {@link SchedulerService} and {@link JobRegistry} contracts (re-exported from
 * `index.ts`); everything else is internal. Marked `@Global` so any module can
 * inject the scheduling contract without importing this module explicitly.
 *
 * Depends only on CORE systems (Events, Cache, Database, Permissions, Config) —
 * never on another feature module.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [SchedulerController],
  providers: [
    // Config
    SchedulerConfigService,
    // Domain
    SchedulerDomainService,
    { provide: JobRegistry, useClass: InMemoryJobRegistry },
    // Infrastructure
    ScheduleRepository,
    SchedulerQueue,
    SchedulerWorker,
    // Application
    { provide: SchedulerService, useClass: SchedulerServiceImpl },
    // SchedulerServiceImpl is also injected directly by the reconciler / cleanup
    // job for the internal `enqueueRecurring` helper not on the public contract.
    {
      provide: SchedulerServiceImpl,
      useExisting: SchedulerService,
    },
    SchedulerQueryService,
    SchedulerLifecycleEmitter,
    ScheduleReconciler,
    MaintenanceHandler,
    CleanupJob,
    SchedulerHealthState,
    // Observability
    SchedulerMetrics,
    SchedulerTracing,
    SchedulerAuditService,
  ],
  exports: [SchedulerService, JobRegistry],
})
export class SchedulerModule {}
