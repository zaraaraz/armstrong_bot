import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetricsController } from './api/metrics.controller';
import { MetricsAdminController } from './api/metrics-admin.controller';
import { MetricsScrapeGuard } from './api/metrics-scrape.guard';
import { MetricsConfigService } from './config/metrics-config.service';
import { MetricsService } from './application/metrics.service.contract';
import { MetricsServiceImpl } from './application/metrics.service';
import { MetricsSnapshotService } from './application/metrics.service.contract';
import { MetricsSnapshotServiceImpl } from './application/metrics-snapshot.service';
import { MetricsSnapshotBuilder } from './application/metrics-snapshot.builder';
import { MetricsSnapshotWriter } from './application/metrics-snapshot.writer';
import { SystemCollectorService } from './application/system-collector.service';
import { ThresholdEvaluatorService } from './application/threshold-evaluator.service';
import { MetricsRegistry } from './infrastructure/metrics.registry';
import { MetricsQueue } from './infrastructure/metrics.queue';
import { MetricsSnapshotRepository } from './infrastructure/repositories/metrics-snapshot.repository';
import { MetricsThresholdRepository } from './infrastructure/repositories/metrics-threshold.repository';
import { MetricsEventConsumer } from './events/metrics-event.consumer';
import { MetricsEventEmitter } from './events/metrics-event.emitter';
import { MetricsSnapshotJob } from './jobs/metrics-snapshot.job';

/**
 * Observability backbone (Phase 4, item 16). Exposes the recording facade
 * (`MetricsService`) and the read-side snapshot facade globally, a guarded
 * Prometheus scrape endpoint, and a Swagger-documented dashboard API. Consumes
 * domain events to derive metrics; emits threshold/snapshot events on the bus.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [MetricsController, MetricsAdminController],
  providers: [
    // Config
    MetricsConfigService,
    // Infrastructure
    MetricsRegistry,
    MetricsQueue,
    MetricsSnapshotRepository,
    MetricsThresholdRepository,
    // Application (facades bound to abstract tokens)
    { provide: MetricsService, useClass: MetricsServiceImpl },
    { provide: MetricsSnapshotService, useClass: MetricsSnapshotServiceImpl },
    MetricsSnapshotBuilder,
    MetricsSnapshotWriter,
    SystemCollectorService,
    ThresholdEvaluatorService,
    // Events
    MetricsEventConsumer,
    MetricsEventEmitter,
    // Jobs
    MetricsSnapshotJob,
    // Guards
    MetricsScrapeGuard,
  ],
  exports: [MetricsService, MetricsSnapshotService],
})
export class MetricsModule {}
