/**
 * Domain error hierarchy for the Storage module. Every failure surfaced to
 * consumers is one of these — callers switch on {@link StorageError.code}
 * (a stable, machine-readable string) rather than parsing messages, and raw
 * driver/SDK error strings are never leaked through them.
 */
export class StorageError extends Error {
  constructor(
    /** Stable, machine-readable error code (never localized, never renamed). */
    public readonly code: string,
    message: string,
    /** Original error, when this wraps a lower-level failure. */
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    // Restore the prototype chain so `instanceof` works after TS downlevel emit.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A guild's storage quota would be exceeded by the attempted write. */
export class StorageQuotaExceededError extends StorageError {
  constructor(
    public readonly guildId: string,
    public readonly usedBytes: number,
    public readonly limitBytes: number,
  ) {
    super(
      'STORAGE_QUOTA_EXCEEDED',
      `Storage quota exceeded for guild ${guildId}: ${usedBytes}/${limitBytes} bytes`,
    );
  }
}

/** The requested object does not exist (or has been soft-deleted). */
export class StorageObjectNotFoundError extends StorageError {
  constructor(public readonly objectId: string) {
    super('STORAGE_OBJECT_NOT_FOUND', `Storage object not found: ${objectId}`);
  }
}

/** The active driver failed to move bytes (wraps the raw backend error). */
export class StorageDriverError extends StorageError {
  constructor(
    public readonly driver: string,
    public readonly operation: string,
    cause?: unknown,
  ) {
    super(
      'STORAGE_DRIVER_ERROR',
      `Storage driver "${driver}" failed during "${operation}"`,
      cause,
    );
  }
}

/** The requested capability is not supported by the active driver/config. */
export class StorageUnsupportedError extends StorageError {
  constructor(message: string) {
    super('STORAGE_UNSUPPORTED', message);
  }
}
