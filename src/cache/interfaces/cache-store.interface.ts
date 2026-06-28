import type { CacheEntry } from './cache-entry.interface';

export interface ICacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<number>;
  has(key: string): Promise<boolean>;
}
