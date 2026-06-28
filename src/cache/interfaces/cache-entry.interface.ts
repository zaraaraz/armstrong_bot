export interface CacheEntry<T> {
  readonly value: T;
  readonly storedAt: number;
  readonly expiresAt: number;
  readonly tags: readonly string[];
}
