import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageConfigService } from './config/storage-config.service';
import { StorageObjectRepository } from './infrastructure/storage-object.repository';
import { LocalStorageDriver } from './infrastructure/drivers/local.driver';
import { S3StorageDriver } from './infrastructure/drivers/s3.driver';
import { NullStorageDriver } from './infrastructure/drivers/null.driver';
import { StorageDriverRegistry } from './infrastructure/drivers/storage-driver.registry';
import { StorageService } from './application/storage.service.contract';
import { StorageServiceImpl } from './application/storage.service';
import { StorageEventEmitter } from './application/storage-event.emitter';
import { StorageMetrics } from './observability/storage.metrics';
import { StorageTracing } from './observability/storage.tracing';
import { StorageAuditService } from './observability/storage.audit';
import { StorageController } from './api/storage.controller';

/**
 * Storage module (Phase 4, item 14). File/blob storage behind a swappable
 * driver seam (local today; S3/R2/Backblaze tomorrow) with content-addressed
 * dedupe, per-guild quotas and soft-delete + GC semantics. Other modules
 * consume ONLY the {@link StorageService} contract exported here.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [StorageController],
  providers: [
    // Config
    StorageConfigService,
    // Infrastructure
    StorageObjectRepository,
    LocalStorageDriver,
    S3StorageDriver,
    NullStorageDriver,
    StorageDriverRegistry,
    // Application
    { provide: StorageService, useClass: StorageServiceImpl },
    StorageEventEmitter,
    // Observability
    StorageMetrics,
    StorageTracing,
    StorageAuditService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
