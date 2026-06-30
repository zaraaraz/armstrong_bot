/** Deterministic factory: pure builder with overridable fields, no DB writes. */
export interface Factory<T> {
  build(overrides?: Partial<T>): T;
  buildMany(count: number, overrides?: Partial<T>): readonly T[];
}

/** Persisting factory: writes via the repository under test, returns the row. */
export interface PersistFactory<T> extends Factory<T> {
  create(overrides?: Partial<T>): Promise<T>;
  createMany(count: number, overrides?: Partial<T>): Promise<readonly T[]>;
}
