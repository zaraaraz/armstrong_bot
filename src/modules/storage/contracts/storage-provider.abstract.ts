import { Readable } from 'node:stream';
import type {
  PutOptions,
  SignOptions,
  SignedUrl,
  StorageObjectMeta,
} from './storage-object.types';

/**
 * The driver contract every storage backend implements. This is the seam that
 * makes backends swappable (local today; S3/R2/Backblaze tomorrow) without any
 * change to the modules that consume StorageService.
 */
export abstract class StorageProvider {
  /** Stable driver identifier, e.g. "local" | "s3" | "null". */
  abstract readonly name: string;

  /** True if this backend can issue signed URLs natively. */
  abstract readonly supportsSignedUrls: boolean;

  abstract put(
    key: string,
    body: Buffer | Readable,
    opts: PutOptions,
  ): Promise<StorageObjectMeta>;

  abstract get(key: string): Promise<Readable>;
  abstract getBuffer(key: string): Promise<Buffer>;
  abstract exists(key: string): Promise<boolean>;
  abstract stat(key: string): Promise<StorageObjectMeta | null>;
  abstract delete(key: string): Promise<void>;
  abstract copy(sourceKey: string, destKey: string): Promise<StorageObjectMeta>;

  abstract list(
    prefix: string,
    limit: number,
    cursor?: string,
  ): Promise<{
    readonly items: readonly StorageObjectMeta[];
    readonly nextCursor?: string;
  }>;

  abstract signGetUrl(key: string, opts: SignOptions): Promise<SignedUrl>;
  abstract signPutUrl(key: string, opts: SignOptions): Promise<SignedUrl>;

  /** Liveness check for health endpoints. */
  abstract healthCheck(): Promise<boolean>;
}
