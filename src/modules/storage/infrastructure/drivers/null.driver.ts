import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';

import type {
  PutOptions,
  SignOptions,
  SignedUrl,
  StorageObjectMeta,
} from '../../contracts/storage-object.types';
import { StorageProvider } from '../../contracts/storage-provider.abstract';
import { sha256Hex } from '../../domain/content-hash.util';

/**
 * A no-op storage driver used in unit tests and dry-run boots. It satisfies the
 * full {@link StorageProvider} contract while persisting nothing: writes are
 * discarded (only the derived metadata is returned) and reads have no bytes to
 * serve. This lets the application service, repository, and event wiring be
 * exercised without touching a real backend, disk, or network.
 *
 * It never signs URLs ({@link supportsSignedUrls} is `false`) and its sign
 * methods throw, mirroring how the registry rejects signing on backends that
 * cannot do it natively.
 */
@Injectable()
export class NullStorageDriver extends StorageProvider {
  readonly name = 'null';
  readonly supportsSignedUrls = false;

  /**
   * Discards the body and returns metadata computed from it. A `Buffer` is
   * hashed directly; a `Readable` is drained fully first so the reported
   * `size`/`contentHash` match what a persisting driver would record.
   */
  async put(
    key: string,
    body: Buffer | Readable,
    opts: PutOptions,
  ): Promise<StorageObjectMeta> {
    const buffer = Buffer.isBuffer(body) ? body : await drain(body);
    return {
      key,
      size: buffer.byteLength,
      contentType: opts.contentType,
      contentHash: sha256Hex(buffer),
      lastModified: new Date(),
    };
  }

  /** The null driver stores nothing, so there is never a stream to serve. */
  get(_key: string): Promise<Readable> {
    return Promise.reject(new Error('null driver has no bytes to read'));
  }

  /** The null driver stores nothing, so there are never bytes to return. */
  getBuffer(_key: string): Promise<Buffer> {
    return Promise.reject(new Error('null driver has no bytes to read'));
  }

  /** Nothing is ever persisted, so no key exists. */
  exists(_key: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  /** Nothing is ever persisted, so there is no metadata to stat. */
  stat(_key: string): Promise<StorageObjectMeta | null> {
    return Promise.resolve(null);
  }

  /** No bytes are held, so deletion is a no-op that always succeeds. */
  delete(_key: string): Promise<void> {
    return Promise.resolve();
  }

  /** There are no source bytes to copy from. */
  copy(_sourceKey: string, _destKey: string): Promise<StorageObjectMeta> {
    return Promise.reject(
      new Error('null driver cannot copy: it holds no bytes'),
    );
  }

  /** Nothing is ever persisted, so every listing is empty. */
  list(
    _prefix: string,
    _limit: number,
    _cursor?: string,
  ): Promise<{
    readonly items: readonly StorageObjectMeta[];
    readonly nextCursor?: string;
  }> {
    return Promise.resolve({ items: [] });
  }

  /** Signed URLs are unsupported by this driver. */
  signGetUrl(_key: string, _opts: SignOptions): Promise<SignedUrl> {
    return Promise.reject(
      new Error('null driver does not support signed URLs'),
    );
  }

  /** Signed URLs are unsupported by this driver. */
  signPutUrl(_key: string, _opts: SignOptions): Promise<SignedUrl> {
    return Promise.reject(
      new Error('null driver does not support signed URLs'),
    );
  }

  /** Always healthy — it depends on no external resource. */
  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** Reads a readable stream fully into a single buffer. */
async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}
