import type { ServerResponse } from 'node:http';
import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from './storage.service.contract';
import { StorageObjectRepository } from '../infrastructure/storage-object.repository';
import { StorageDriverRegistry } from '../infrastructure/drivers/storage-driver.registry';
import { LocalStorageDriver } from '../infrastructure/drivers/local.driver';
import { StorageConfigService } from '../config/storage-config.service';
import { StorageEventEmitter } from './storage-event.emitter';
import { StorageMetrics } from '../observability/storage.metrics';
import { StorageTracing } from '../observability/storage.tracing';
import { buildObjectKey, sha256Hex } from '../domain/content-hash.util';
import {
  StorageObjectNotFoundError,
  StorageQuotaExceededError,
} from '../domain/storage.errors';
import type {
  StorageObjectEntity,
  StoredObjectRef,
} from '../domain/storage-object.entity';
import type { SignedUrl } from '../contracts/storage-object.types';
import type {
  ListObjectsQuery,
  Paginated,
  SignedDownloadParams,
  StorageUsageSummary,
  StoreParams,
} from './storage.service.contract';

// Re-export the input shapes so consumers (and tests) can import them alongside
// the concrete service without reaching into the contract file.
export type {
  ListObjectsQuery,
  Paginated,
  StorageUsageSummary,
  StoreParams,
} from './storage.service.contract';

/**
 * Public application service implementing the storage contract. It is the single
 * boundary that keeps the byte store (driver) and the catalog (Prisma, via the
 * repository) consistent: it hashes the body for content-addressing, enforces the
 * per-guild quota, dedupes identical bytes by ref-counting, and only then writes
 * bytes + a catalog row and emits lifecycle events. No consumer ever sees a driver
 * SDK, a Prisma model, or a hand-built key.
 */
@Injectable()
export class StorageServiceImpl extends StorageService {
  private readonly logger = new Logger(StorageServiceImpl.name);

  constructor(
    private readonly repo: StorageObjectRepository,
    private readonly drivers: StorageDriverRegistry,
    private readonly config: StorageConfigService,
    private readonly emitter: StorageEventEmitter,
    private readonly metrics: StorageMetrics,
    private readonly tracing: StorageTracing,
    // Injected directly (not via the registry) because the signed-proxy download
    // is a local-driver concept: only it can verify its own HMAC links.
    private readonly localDriver: LocalStorageDriver,
  ) {
    super();
  }

  async store(params: StoreParams): Promise<StoredObjectRef> {
    const body = await toBuffer(params.body);
    const contentHash = sha256Hex(body);
    const size = body.length;
    const key = buildObjectKey(params.guildId, params.namespace, contentHash);

    // Quota is enforced before any byte reaches the driver.
    await this.assertWithinQuota(params.guildId, size);

    const existing = await this.repo.findByHash(
      params.guildId,
      params.namespace,
      contentHash,
    );
    if (existing) {
      return this.storeDeduped(existing);
    }

    return this.storeFresh({ body, contentHash, size, key, params });
  }

  async getBuffer(objectId: string): Promise<Buffer> {
    const entity = await this.requireObject(objectId);
    const buffer = await this.drivers.active().getBuffer(entity.key);
    await this.emitAccessed(entity);
    return buffer;
  }

  async signDownloadUrl(
    objectId: string,
    expiresInSeconds?: number,
  ): Promise<SignedUrl> {
    const entity = await this.requireObject(objectId);
    const signed = await this.drivers.active().signGetUrl(entity.key, {
      expiresInSeconds: this.boundedTtl(expiresInSeconds),
      downloadFilename: entity.filename ?? undefined,
    });
    await this.emitAccessed(entity);
    return signed;
  }

  async delete(objectId: string, guildId?: string | null): Promise<void> {
    const entity = await this.requireObject(objectId, guildId);
    await this.repo.softDelete(entity.id);
    await this.repo.decrementRefCount(entity.id);

    // Byte reclamation is deferred to GC once refCount reaches 0; here we only
    // release this row's claim on the guild's aggregate usage.
    if (entity.guildId) {
      const snapshot = await this.repo.addUsage(
        entity.guildId,
        -entity.size,
        -1,
      );
      this.metrics.setUsedBytes(snapshot.usedBytes);
    }
    this.metrics.recordDelete(entity.namespace);

    await this.emitter.emit(this.emitter.events.ObjectDeleted, {
      ...this.objectPayload(entity),
    });
    this.logger.debug(
      `deleted storage object ${entity.id} (trace ${this.tracing.currentTraceId()})`,
    );
  }

  async usage(guildId: string): Promise<StorageUsageSummary> {
    const [snapshot, guildConfig] = await Promise.all([
      this.repo.getUsage(guildId),
      this.config.forGuild(guildId),
    ]);
    return {
      usedBytes: snapshot?.usedBytes ?? 0,
      objectCount: snapshot?.objectCount ?? 0,
      quotaBytes: guildConfig.quotaBytes,
    };
  }

  async list(query: ListObjectsQuery): Promise<Paginated<StoredObjectRef>> {
    const result = await this.repo.list({
      guildId: query.guildId,
      namespace: query.namespace,
      ownerType: query.ownerType,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: result.items.map(toRef),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async serveSignedDownload(
    params: SignedDownloadParams,
    res: ServerResponse,
  ): Promise<void> {
    const { key, exp, sig } = params;
    const expiry = Number(exp);
    if (!key || !sig || !Number.isFinite(expiry)) {
      res.statusCode = 401;
      res.end('invalid signature');
      return;
    }
    if (expiry * 1000 < Date.now()) {
      res.statusCode = 410;
      res.end('link expired');
      return;
    }
    const valid = this.localDriver.verifySignature(
      { key, method: 'GET', exp: expiry },
      sig,
    );
    if (!valid) {
      res.statusCode = 401;
      res.end('invalid signature');
      return;
    }

    res.setHeader(
      'Content-Type',
      params.contentType ?? 'application/octet-stream',
    );
    if (params.filename) {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${params.filename.replace(/"/g, '')}"`,
      );
    }
    const stream = await this.localDriver.get(key);
    await new Promise<void>((resolve, reject) => {
      stream.pipe(res);
      stream.on('error', reject);
      res.on('finish', resolve);
      res.on('close', resolve);
    });
  }

  /** Dedupe hit: bytes already exist, so bump the ref-count and reuse them. */
  private async storeDeduped(
    existing: StorageObjectEntity,
  ): Promise<StoredObjectRef> {
    await this.repo.incrementRefCount(existing.id);
    this.metrics.recordStore(existing.namespace, true, existing.size);
    await this.emitter.emit(this.emitter.events.ObjectStored, {
      ...this.objectPayload(existing),
      deduped: true,
    });
    return { ...toRef(existing), deduped: true };
  }

  /** No existing bytes: write to the driver, catalog the row, account usage. */
  private async storeFresh(args: {
    body: Buffer;
    contentHash: string;
    size: number;
    key: string;
    params: StoreParams;
  }): Promise<StoredObjectRef> {
    const { body, contentHash, size, key, params } = args;
    const immutable = params.immutable ?? true;

    await this.drivers.active().put(key, body, {
      contentType: params.contentType,
      immutable,
    });

    const entity = await this.repo.create({
      guildId: params.guildId,
      namespace: params.namespace,
      key,
      contentHash,
      size,
      contentType: params.contentType,
      filename: params.filename ?? null,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      immutable,
      metadata: null,
    });

    if (params.guildId) {
      const snapshot = await this.repo.addUsage(params.guildId, size, 1);
      this.metrics.setUsedBytes(snapshot.usedBytes);
    }
    this.metrics.recordStore(entity.namespace, false, size);
    await this.emitter.emit(this.emitter.events.ObjectStored, {
      ...this.objectPayload(entity),
      deduped: false,
    });

    return { ...toRef(entity), deduped: false };
  }

  /** Reject and signal when a write would push a guild past its quota. */
  private async assertWithinQuota(
    guildId: string | null,
    size: number,
  ): Promise<void> {
    if (guildId === null) return; // global objects are not guild-quota-bound

    const guildConfig = await this.config.forGuild(guildId);
    if (guildConfig.quotaBytes === 0) return; // 0 => unlimited

    const snapshot = await this.repo.getUsage(guildId);
    const projected = (snapshot?.usedBytes ?? 0) + size;
    if (projected <= guildConfig.quotaBytes) return;

    await this.emitter.emit(this.emitter.events.QuotaExceeded, {
      guildId,
      usedBytes: projected,
      quotaBytes: guildConfig.quotaBytes,
      occurredAt: new Date().toISOString(),
    });
    throw new StorageQuotaExceededError(
      guildId,
      projected,
      guildConfig.quotaBytes,
    );
  }

  private async requireObject(
    objectId: string,
    guildId?: string | null,
  ): Promise<StorageObjectEntity> {
    const entity = await this.repo.findById(objectId);
    if (!entity) throw new StorageObjectNotFoundError(objectId);
    // Guild scoping: a handle for one guild can never reach another's object.
    if (guildId !== undefined && entity.guildId !== guildId) {
      throw new StorageObjectNotFoundError(objectId);
    }
    return entity;
  }

  private async emitAccessed(entity: StorageObjectEntity): Promise<void> {
    await this.emitter.emit(this.emitter.events.ObjectAccessed, {
      ...this.objectPayload(entity),
    });
  }

  private boundedTtl(requested?: number): number {
    const max = this.config.global().maxSignedUrlSeconds;
    if (requested === undefined) return max;
    return Math.min(Math.max(1, requested), max);
  }

  /** Build the shared object-lifecycle event payload from a catalog entity. */
  private objectPayload(entity: StorageObjectEntity): {
    objectId: string;
    key: string;
    guildId: string | null;
    namespace: string;
    size: number;
    contentHash: string;
    ownerType: string;
    ownerId: string;
    occurredAt: string;
  } {
    return {
      objectId: entity.id,
      key: entity.key,
      guildId: entity.guildId,
      namespace: entity.namespace,
      size: entity.size,
      contentHash: entity.contentHash,
      ownerType: entity.ownerType,
      ownerId: entity.ownerId,
      occurredAt: new Date().toISOString(),
    };
  }
}

/** Map a catalog entity to the narrow reference handed back to consumers. */
function toRef(entity: StorageObjectEntity): StoredObjectRef {
  return {
    id: entity.id,
    key: entity.key,
    namespace: entity.namespace,
    size: entity.size,
    contentHash: entity.contentHash,
    deduped: false,
  };
}

/** Read a Buffer through unchanged; drain a readable stream into one Buffer. */
async function toBuffer(body: Buffer | NodeJS.ReadableStream): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
