import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Injectable, Logger } from '@nestjs/common';

import type {
  PutOptions,
  SignedUrl,
  SignOptions,
  StorageObjectMeta,
} from '../../contracts/storage-object.types';
import { StorageProvider } from '../../contracts/storage-provider.abstract';
import { StorageConfigService } from '../../config/storage-config.service';

/** Fields carried in the HMAC payload of a local signed-proxy URL. */
export interface SignaturePayload {
  readonly key: string;
  readonly method: 'GET' | 'PUT';
  readonly exp: number; // unix seconds
}

/**
 * Filesystem-backed {@link StorageProvider}. Bytes live under `localRoot` at the
 * object's content-addressed key. Since the local filesystem cannot sign URLs
 * natively, this driver issues an HMAC-signed proxy URL that points back at the
 * app's own download route (`/api/v1/storage/download`); the route validates the
 * signature and expiry before streaming the file. It moves bytes only and knows
 * nothing about Prisma, guilds, quotas, or events.
 */
@Injectable()
export class LocalStorageDriver extends StorageProvider {
  readonly name = 'local';
  readonly supportsSignedUrls = true;

  private readonly logger = new Logger(LocalStorageDriver.name);

  constructor(private readonly config: StorageConfigService) {
    super();
  }

  async put(
    key: string,
    body: Buffer | Readable,
    opts: PutOptions,
  ): Promise<StorageObjectMeta> {
    const abs = this.resolve(key);
    await mkdir(dirname(abs), { recursive: true });

    const buffer = Buffer.isBuffer(body) ? body : await this.drain(body);
    await writeFile(abs, buffer);

    return {
      key,
      size: buffer.byteLength,
      contentType: opts.contentType,
      contentHash: createHash('sha256').update(buffer).digest('hex'),
      lastModified: new Date(),
    };
  }

  get(key: string): Promise<Readable> {
    return Promise.resolve(createReadStream(this.resolve(key)));
  }

  async getBuffer(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async stat(key: string): Promise<StorageObjectMeta | null> {
    try {
      const st = await stat(this.resolve(key));
      if (!st.isFile()) return null;
      return {
        key,
        size: st.size,
        contentType: 'application/octet-stream',
        contentHash: await this.hashFile(key),
        lastModified: st.mtime,
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async copy(sourceKey: string, destKey: string): Promise<StorageObjectMeta> {
    const src = this.resolve(sourceKey);
    const dest = this.resolve(destKey);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);

    const st = await stat(dest);
    return {
      key: destKey,
      size: st.size,
      contentType: 'application/octet-stream',
      contentHash: await this.hashFile(destKey),
      lastModified: st.mtime,
    };
  }

  async list(
    prefix: string,
    limit: number,
    cursor?: string,
  ): Promise<{
    readonly items: readonly StorageObjectMeta[];
    readonly nextCursor?: string;
  }> {
    const root = this.resolve(prefix);
    let names: string[];
    try {
      names = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return { items: [] };
    }

    const start = cursor ? names.indexOf(cursor) + 1 : 0;
    const slice = names.slice(start, start + limit);

    const items = await Promise.all(
      slice.map(async (name) => {
        const key = posix.join(prefix, name);
        const st = await stat(join(root, name));
        return {
          key,
          size: st.size,
          contentType: 'application/octet-stream',
          contentHash: await this.hashFile(key),
          lastModified: st.mtime,
        } satisfies StorageObjectMeta;
      }),
    );

    const consumedTo = start + slice.length;
    const nextCursor =
      consumedTo < names.length ? slice[slice.length - 1] : undefined;
    return nextCursor ? { items, nextCursor } : { items };
  }

  signGetUrl(key: string, opts: SignOptions): Promise<SignedUrl> {
    return Promise.resolve(this.sign(key, 'GET', opts));
  }

  signPutUrl(key: string, opts: SignOptions): Promise<SignedUrl> {
    return Promise.resolve(this.sign(key, 'PUT', opts));
  }

  async healthCheck(): Promise<boolean> {
    const { localRoot } = this.config.global();
    const marker = join(localRoot, `.healthcheck-${process.pid}-${Date.now()}`);
    try {
      await mkdir(localRoot, { recursive: true });
      await writeFile(marker, 'ok');
      await unlink(marker);
      return true;
    } catch (err) {
      this.logger.error(
        `Local storage healthcheck failed: ${this.reason(err)}`,
      );
      return false;
    }
  }

  /** Build an HMAC-signed proxy URL for the app's own download route. */
  private sign(
    key: string,
    method: 'GET' | 'PUT',
    opts: SignOptions,
  ): SignedUrl {
    const { publicBaseUrl, maxSignedUrlSeconds } = this.config.global();
    const ttl = Math.max(
      1,
      Math.min(opts.expiresInSeconds, maxSignedUrlSeconds),
    );
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = this.signature({ key, method, exp });

    const params = new URLSearchParams({
      key,
      exp: String(exp),
      sig,
    });
    if (opts.downloadFilename) {
      params.set('filename', opts.downloadFilename);
    }
    if (opts.contentType) {
      params.set('contentType', opts.contentType);
    }

    const base = publicBaseUrl.replace(/\/+$/, '');
    const url = `${base}/api/v1/storage/download?${params.toString()}`;

    return {
      url,
      method,
      expiresAt: new Date(exp * 1000),
      ...(method === 'PUT' && opts.contentType
        ? { headers: { 'Content-Type': opts.contentType } }
        : {}),
    };
  }

  /** Recompute the signature for a payload and constant-time compare it. */
  verifySignature(payload: SignaturePayload, candidate: string): boolean {
    if (payload.exp * 1000 < Date.now()) return false;
    const expected = this.signature(payload);
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(candidate, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Deterministic HMAC-SHA256 over the canonical `method\nkey\nexp` payload. */
  private signature(payload: SignaturePayload): string {
    const { signingSecret } = this.config.global();
    return createHmac('sha256', signingSecret)
      .update(`${payload.method}\n${payload.key}\n${payload.exp}`)
      .digest('hex');
  }

  /** Resolve a backend-relative key to an absolute path inside `localRoot`. */
  private resolve(key: string): string {
    const root = this.config.global().localRoot;
    const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
    return join(root, ...normalized.split('/'));
  }

  private async hashFile(key: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(this.resolve(key)), hash);
    return hash.digest('hex');
  }

  /** Collect a readable stream into a single Buffer. */
  private async drain(body: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string),
      );
    }
    return Buffer.concat(chunks);
  }

  /** Extract a safe error reason without leaking driver internals to logs. */
  private reason(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
