import type { ServerResponse } from 'node:http';
import type { SignedUrl } from '../contracts/storage-object.types';
import type { StorageNamespace } from '../domain/storage-namespace';
import type { StoredObjectRef } from '../domain/storage-object.entity';

/**
 * Query params carried by a local-driver signed-proxy download link. All fields
 * arrive as raw strings from the URL; the service validates and coerces them.
 */
export interface SignedDownloadParams {
  readonly key?: string;
  readonly exp?: string;
  readonly sig?: string;
  readonly filename?: string;
  readonly contentType?: string;
}

/**
 * Input to {@link StorageService.store}. `body` is read fully (hashed for
 * content-addressing) before any byte reaches the driver; a `guildId` of `null`
 * denotes a global object (which requires platform-level authority at the call
 * site). `immutable` defaults to true — content-addressed bytes never mutate.
 */
export interface StoreParams {
  /** null => global object (not scoped to a guild). */
  readonly guildId: string | null;
  readonly namespace: StorageNamespace;
  readonly body: Buffer | NodeJS.ReadableStream;
  readonly contentType: string;
  /** Owning entity kind, e.g. 'ticket' | 'guild' | 'user' | 'plugin'. */
  readonly ownerType: string;
  readonly ownerId: string;
  readonly filename?: string;
  readonly immutable?: boolean;
}

/**
 * Filter/pagination for {@link StorageService.list}. Page is clamped to >= 1 and
 * pageSize to <= 100 by the repository; passing `guildId` restricts the listing
 * to that guild (omit for a platform-wide view).
 */
export interface ListObjectsQuery {
  readonly guildId?: string | null;
  readonly namespace?: StorageNamespace;
  readonly ownerType?: string;
  readonly page: number;
  readonly pageSize: number;
}

/** A single page of results, mirroring the repository's pagination envelope. */
export interface Paginated<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Per-guild usage snapshot for quota gauges. `quotaBytes` is the resolved limit
 * (0 => unlimited) layered over the global default by the config service.
 */
export interface StorageUsageSummary {
  readonly usedBytes: number;
  readonly objectCount: number;
  readonly quotaBytes: number;
}

/**
 * The public storage contract. This is the ONLY storage surface other modules
 * may depend on — they never touch a driver SDK, build a key, sign a URL, or
 * reach the Prisma catalog by hand. Every operation is guild-scoped: bytes and
 * catalog rows are consistent because this service is the single boundary that
 * enforces hashing, dedupe ref-counting, quota, and soft-delete semantics.
 */
export abstract class StorageService {
  /** Hash, dedupe, quota-check and catalog an object, then persist its bytes. */
  abstract store(params: StoreParams): Promise<StoredObjectRef>;

  /** Fetch an object's raw bytes through the active driver. */
  abstract getBuffer(objectId: string): Promise<Buffer>;

  /** Issue a time-limited signed GET URL (TTL bounded by config max). */
  abstract signDownloadUrl(
    objectId: string,
    expiresInSeconds?: number,
  ): Promise<SignedUrl>;

  /**
   * Soft-delete the catalog row and release one byte reference. `guildId` scopes
   * the delete to a guild's object (a handle for guild A can never remove guild
   * B's object); omit it for global/platform-level deletes.
   */
  abstract delete(objectId: string, guildId?: string | null): Promise<void>;

  /** Resolve a guild's aggregate usage against its quota. */
  abstract usage(guildId: string): Promise<StorageUsageSummary>;

  /** Paginated catalog listing for the dashboard/admin API. */
  abstract list(query: ListObjectsQuery): Promise<Paginated<StoredObjectRef>>;

  /**
   * Serve a local-driver signed-proxy download: verify the HMAC signature and
   * expiry minted by the local driver, then stream the bytes to the response.
   * Authority comes entirely from `sig`/`exp` — no session or claim involved.
   */
  abstract serveSignedDownload(
    params: SignedDownloadParams,
    res: ServerResponse,
  ): Promise<void>;
}
