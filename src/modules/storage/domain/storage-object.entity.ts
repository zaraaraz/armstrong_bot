import type { StorageNamespace } from './storage-namespace';

/**
 * Domain representation of a persisted `StorageObject` catalog row. Internal to
 * the module; consumers see only response DTOs / {@link StoredObjectRef}. Bytes
 * themselves live in the active driver, keyed by {@link StorageObjectEntity.key}.
 */
export interface StorageObjectEntity {
  readonly id: string;
  /** null => global object (not scoped to a guild). */
  readonly guildId: string | null;
  readonly namespace: StorageNamespace;
  /** Backend-relative, content-addressed key: "{guild|global}/{ns}/{hash}". */
  readonly key: string;
  /** sha256 hex — the dedupe anchor. */
  readonly contentHash: string;
  readonly size: number;
  readonly contentType: string;
  readonly filename: string | null;
  /** Owning entity kind, e.g. 'ticket' | 'guild' | 'user' | 'plugin'. */
  readonly ownerType: string;
  readonly ownerId: string;
  /** Content-addressed => bytes never mutate; safe to cache forever. */
  readonly immutable: boolean;
  /** How many catalog rows point at the same contentHash bytes. */
  readonly refCount: number;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Soft-delete marker; bytes are removed by GC only once refCount hits 0. */
  readonly deletedAt: Date | null;
}

/**
 * The narrow reference handed back to consumers after a store. Deliberately
 * omits owner/metadata/timestamps; `deduped` reports whether the bytes already
 * existed (a ref-count bump rather than a fresh upload).
 */
export interface StoredObjectRef {
  readonly id: string;
  readonly key: string;
  readonly namespace: StorageNamespace;
  readonly size: number;
  readonly contentHash: string;
  readonly deduped: boolean;
}
