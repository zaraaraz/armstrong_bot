import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { StorageObjectEntity } from '../domain/storage-object.entity';
import type { StorageNamespace } from '../domain/storage-namespace';

/** Raw `StorageObject` row as returned by the Prisma client. */
interface StorageObjectRow {
  id: string;
  guildId: string | null;
  namespace: StorageNamespace;
  key: string;
  contentHash: string;
  size: number;
  contentType: string;
  filename: string | null;
  ownerType: string;
  ownerId: string;
  immutable: boolean;
  refCount: number;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Raw `StorageUsage` row; `usedBytes` is a BigInt in the client. */
interface StorageUsageRow {
  guildId: string;
  usedBytes: bigint;
  objectCount: number;
  updatedAt: Date;
}

/** Fields required to catalog a freshly stored (or deduped-anchor) object. */
export interface CreateStorageObjectInput {
  guildId: string | null;
  namespace: StorageNamespace;
  key: string;
  contentHash: string;
  size: number;
  contentType: string;
  filename: string | null;
  ownerType: string;
  ownerId: string;
  immutable: boolean;
  metadata: Record<string, unknown> | null;
}

export interface ListStorageObjectsQuery {
  guildId?: string | null;
  namespace?: StorageNamespace;
  ownerType?: string;
  page: number;
  pageSize: number;
  /** When true, soft-deleted rows are included (admin/GC/debug only). */
  withDeleted?: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Per-guild aggregate usage snapshot. `usedBytes` is surfaced as a `number` for
 * consumer ergonomics (quota checks); the underlying column is a BigInt.
 */
export interface StorageUsageSnapshot {
  guildId: string;
  usedBytes: number;
  objectCount: number;
  updatedAt: Date;
}

/**
 * The ONLY class permitted to touch the storage Prisma tables. Encapsulates the
 * content-hash dedupe lookup, ref-counting, soft-delete, pagination, GC scans
 * and the per-guild usage aggregate. Repository Pattern per the spec.
 */
@Injectable()
export class StorageObjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get objects() {
    return this.prisma['storageObject'];
  }

  private get usage() {
    return this.prisma['storageUsage'];
  }

  /**
   * The dedupe anchor: the first live catalog row sharing this content hash
   * within the guild/namespace. A hit means the bytes already exist and a
   * `put` need only bump the ref-count.
   */
  async findByHash(
    guildId: string | null,
    namespace: StorageNamespace,
    contentHash: string,
  ): Promise<StorageObjectEntity | null> {
    const row = (await this.objects.findFirst({
      where: { guildId, namespace, contentHash, deletedAt: null },
    })) as StorageObjectRow | null;
    return row ? this.toEntity(row) : null;
  }

  async create(data: CreateStorageObjectInput): Promise<StorageObjectEntity> {
    const { metadata, ...rest } = data;
    const row = (await this.objects.create({
      data: {
        ...rest,
        // Prisma's nullable-Json input rejects a plain `null`; omit instead.
        ...(metadata != null
          ? { metadata: metadata as Prisma.InputJsonValue }
          : {}),
      },
    })) as StorageObjectRow;
    return this.toEntity(row);
  }

  /** Dedupe hit: a new catalog row reuses existing bytes, so bump the count. */
  async incrementRefCount(id: string): Promise<StorageObjectEntity> {
    const row = (await this.objects.update({
      where: { id },
      data: { refCount: { increment: 1 } },
    })) as StorageObjectRow;
    return this.toEntity(row);
  }

  async findById(id: string): Promise<StorageObjectEntity | null> {
    const row = (await this.objects.findFirst({
      where: { id, deletedAt: null },
    })) as StorageObjectRow | null;
    return row ? this.toEntity(row) : null;
  }

  /** Soft-delete: mark removed but leave bytes for GC to reclaim at refCount 0. */
  async softDelete(id: string): Promise<void> {
    await this.objects.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Release one reference; returns the new ref-count (0 => bytes are orphaned). */
  async decrementRefCount(id: string): Promise<number> {
    const row = (await this.objects.update({
      where: { id },
      data: { refCount: { decrement: 1 } },
    })) as StorageObjectRow;
    return row.refCount;
  }

  async list(
    query: ListStorageObjectsQuery,
  ): Promise<Paginated<StorageObjectEntity>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const where = {
      ...(query.withDeleted ? {} : { deletedAt: null }),
      ...(query.guildId !== undefined ? { guildId: query.guildId } : {}),
      ...(query.namespace ? { namespace: query.namespace } : {}),
      ...(query.ownerType ? { ownerType: query.ownerType } : {}),
    };

    const [rows, total] = await Promise.all([
      this.objects.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }) as Promise<StorageObjectRow[]>,
      this.objects.count({ where }) as Promise<number>,
    ]);

    return {
      items: rows.map((row) => this.toEntity(row)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * GC scan: soft-deleted rows whose refs have all been released. Their bytes
   * are orphaned and safe to reclaim from the driver.
   */
  async findDeletedWithZeroRefs(limit: number): Promise<StorageObjectEntity[]> {
    const take = Math.min(100, Math.max(1, limit));
    const rows = (await this.objects.findMany({
      where: { deletedAt: { not: null }, refCount: { lte: 0 } },
      take,
      orderBy: { deletedAt: 'asc' },
    })) as StorageObjectRow[];
    return rows.map((row) => this.toEntity(row));
  }

  // ─── Usage aggregate ───────────────────────────────────────────────────────

  async getUsage(guildId: string): Promise<StorageUsageSnapshot | null> {
    const row = await this.usage.findUnique({
      where: { guildId },
    });
    return row ? toUsageSnapshot(row) : null;
  }

  /**
   * Apply a signed delta to a guild's usage aggregate, creating the row if it
   * does not exist. `usedBytes` is a BigInt column, so the delta is combined
   * with BigInt arithmetic and stored as a bigint.
   */
  async addUsage(
    guildId: string,
    bytesDelta: number,
    countDelta: number,
  ): Promise<StorageUsageSnapshot> {
    const bytes = BigInt(bytesDelta);
    const row = await this.usage.upsert({
      where: { guildId },
      create: {
        guildId,
        usedBytes: bytes,
        objectCount: countDelta,
      },
      update: {
        usedBytes: { increment: bytes },
        objectCount: { increment: countDelta },
      },
    });
    return toUsageSnapshot(row);
  }

  private toEntity(row: StorageObjectRow): StorageObjectEntity {
    return {
      id: row.id,
      guildId: row.guildId,
      namespace: row.namespace,
      key: row.key,
      contentHash: row.contentHash,
      size: row.size,
      contentType: row.contentType,
      filename: row.filename,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      immutable: row.immutable,
      refCount: row.refCount,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}

function toUsageSnapshot(row: StorageUsageRow): StorageUsageSnapshot {
  return {
    guildId: row.guildId,
    usedBytes: Number(row.usedBytes),
    objectCount: row.objectCount,
    updatedAt: row.updatedAt,
  };
}
