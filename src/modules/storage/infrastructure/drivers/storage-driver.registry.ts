import { Injectable } from '@nestjs/common';
import { StorageProvider } from '../../contracts/storage-provider.abstract';
import { StorageConfigService } from '../../config/storage-config.service';
import { StorageUnsupportedError } from '../../domain/storage.errors';
import { LocalStorageDriver } from './local.driver';
import { S3StorageDriver } from './s3.driver';
import { NullStorageDriver } from './null.driver';

/**
 * Maps a configured driver name to its {@link StorageProvider} instance. This
 * is the single seam that keeps {@link StorageService} driver-agnostic: the
 * service asks the registry for {@link active} and never references a concrete
 * driver, so adding a backend is a config flip plus a registry entry — with
 * zero changes to any consuming module.
 *
 * Drivers are constructor-injected (VALUE imports) so Nest owns their lifecycle
 * and each driver keeps its own dependencies (config, HMAC secret, S3 client).
 */
@Injectable()
export class StorageDriverRegistry {
  private readonly drivers: ReadonlyMap<string, StorageProvider>;

  constructor(
    private readonly config: StorageConfigService,
    local: LocalStorageDriver,
    s3: S3StorageDriver,
    nullDriver: NullStorageDriver,
  ) {
    this.drivers = new Map<string, StorageProvider>([
      [local.name, local],
      [s3.name, s3],
      [nullDriver.name, nullDriver],
    ]);
  }

  /** The driver selected by the resolved global config (`STORAGE_DRIVER`). */
  active(): StorageProvider {
    return this.byName(this.config.global().driver);
  }

  /** Resolve a driver by its stable name, or throw if none is registered. */
  byName(name: string): StorageProvider {
    const driver = this.drivers.get(name);
    if (!driver) {
      throw new StorageUnsupportedError(
        `No storage driver registered for "${name}" (available: ${[
          ...this.drivers.keys(),
        ].join(', ')})`,
      );
    }
    return driver;
  }
}
