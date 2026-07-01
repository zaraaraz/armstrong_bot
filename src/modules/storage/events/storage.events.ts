/** Namespaced lifecycle event names emitted on the core Event Bus. */
export const StorageEvents = {
  ObjectStored: 'storage.object.stored',
  ObjectDeleted: 'storage.object.deleted',
  ObjectAccessed: 'storage.object.accessed',
  QuotaExceeded: 'storage.quota.exceeded',
  GcCompleted: 'storage.gc.completed',
} as const;

export type StorageEventName =
  (typeof StorageEvents)[keyof typeof StorageEvents];

export interface StorageObjectEventPayload {
  readonly objectId: string;
  readonly key: string;
  readonly guildId: string | null;
  readonly namespace: string;
  readonly size: number;
  readonly contentHash: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly occurredAt: string; // ISO
}

export interface QuotaExceededPayload {
  readonly guildId: string;
  readonly usedBytes: number;
  readonly quotaBytes: number;
  readonly occurredAt: string; // ISO
}

export interface GcCompletedPayload {
  readonly deletedObjects: number;
  readonly freedBytes: number;
  readonly occurredAt: string; // ISO
}
