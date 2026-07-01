import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';

import type {
  PutOptions,
  SignOptions,
  SignedUrl,
  StorageObjectMeta,
} from '../../contracts/storage-object.types';
import { StorageProvider } from '../../contracts/storage-provider.abstract';
import { StorageConfigService } from '../../config/storage-config.service';
import { StorageError } from '../../domain/storage.errors';

/**
 * Interface-complete {@link StorageProvider} seam for every S3-compatible
 * backend — AWS S3, Cloudflare R2, and Backblaze B2 all speak the same wire API
 * and differ only by `endpoint`/`region`/`forcePathStyle` (see the `s3` block of
 * {@link StorageConfigService.global}). Selecting any of them is a config change,
 * not a code change: flip `STORAGE_DRIVER` and supply the S3 credentials.
 *
 * The concrete byte-moving implementation is intentionally deferred so the module
 * ships without pulling the heavy `@aws-sdk/client-s3` dependency before it is
 * needed. This class exists today to prove swappability: it implements the full
 * contract with exact signatures, but every operation throws a clear
 * {@link StorageError} ({@link S3StorageDriver.notProvisioned}) directing the
 * operator to install the SDK and provide credentials. When the SDK is added,
 * the method bodies fill in against an `S3Client` built from the resolved config;
 * no consumer of {@link StorageProvider} changes.
 */
@Injectable()
export class S3StorageDriver extends StorageProvider {
  readonly name = 's3';
  readonly supportsSignedUrls = true;

  private readonly logger = new Logger(S3StorageDriver.name);

  constructor(private readonly config: StorageConfigService) {
    super();
  }

  put(
    _key: string,
    _body: Buffer | Readable,
    _opts: PutOptions,
  ): Promise<StorageObjectMeta> {
    throw this.notProvisioned('put');
  }

  get(_key: string): Promise<Readable> {
    throw this.notProvisioned('get');
  }

  getBuffer(_key: string): Promise<Buffer> {
    throw this.notProvisioned('getBuffer');
  }

  exists(_key: string): Promise<boolean> {
    throw this.notProvisioned('exists');
  }

  stat(_key: string): Promise<StorageObjectMeta | null> {
    throw this.notProvisioned('stat');
  }

  delete(_key: string): Promise<void> {
    throw this.notProvisioned('delete');
  }

  copy(_sourceKey: string, _destKey: string): Promise<StorageObjectMeta> {
    throw this.notProvisioned('copy');
  }

  list(
    _prefix: string,
    _limit: number,
    _cursor?: string,
  ): Promise<{
    readonly items: readonly StorageObjectMeta[];
    readonly nextCursor?: string;
  }> {
    throw this.notProvisioned('list');
  }

  signGetUrl(_key: string, _opts: SignOptions): Promise<SignedUrl> {
    throw this.notProvisioned('signGetUrl');
  }

  signPutUrl(_key: string, _opts: SignOptions): Promise<SignedUrl> {
    throw this.notProvisioned('signPutUrl');
  }

  /**
   * Reports unhealthy: with no SDK linked the backend can never be reached, so a
   * health endpoint must show the driver as down rather than falsely green.
   */
  healthCheck(): Promise<boolean> {
    this.logger.warn(
      's3 driver is a config-only seam; install @aws-sdk/client-s3 to enable it',
    );
    return Promise.resolve(false);
  }

  /**
   * Build the uniform "not yet provisioned" error thrown by every operation. The
   * message names the exact remediation steps and never leaks credentials from
   * the resolved config.
   */
  private notProvisioned(operation: string): StorageError {
    void this.config;
    return new StorageError(
      'STORAGE_S3_NOT_PROVISIONED',
      `s3 driver not yet provisioned — set STORAGE_DRIVER + S3 credentials and install @aws-sdk/client-s3 (operation: ${operation})`,
    );
  }
}
