/**
 * Storage module — PUBLIC API barrel.
 *
 * These are the ONLY symbols other modules may import. Everything else
 * (repository, drivers, the registry, config service, observability) is
 * internal to this module.
 */
export { StorageModule } from './storage.module';

// Storage contract (abstract service token)
export { StorageService } from './application/storage.service.contract';
export type {
  StoreParams,
  ListObjectsQuery,
  Paginated,
  StorageUsageSummary,
  SignedDownloadParams,
} from './application/storage.service.contract';

// Public value types
export { StorageNamespace } from './domain/storage-namespace';
export type {
  StorageObjectEntity,
  StoredObjectRef,
} from './domain/storage-object.entity';
export type {
  SignedUrl,
  StorageObjectMeta,
} from './contracts/storage-object.types';

// Errors consumers may catch
export {
  StorageError,
  StorageObjectNotFoundError,
  StorageQuotaExceededError,
} from './domain/storage.errors';

// Events
export { StorageEvents, type StorageEventName } from './events/storage.events';
