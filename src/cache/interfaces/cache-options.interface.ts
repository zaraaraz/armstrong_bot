export interface CacheGetOrSetOptions<T> {
  readonly ttlSeconds: number;
  readonly jitterSeconds?: number;
  readonly tags?: readonly string[];
  readonly l2Only?: boolean;
  readonly validate?: (value: unknown) => T;
}

export interface CacheSetOptions {
  readonly ttlSeconds: number;
  readonly jitterSeconds?: number;
  readonly tags?: readonly string[];
  readonly l2Only?: boolean;
}
