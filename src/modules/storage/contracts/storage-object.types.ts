/** Metadata describing a stored object, as reported by a driver. */
export interface StorageObjectMeta {
  /** Backend-relative key, content-addressed: "{guild|global}/{ns}/{hash}". */
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
  /** sha256 hex — the dedupe anchor. */
  readonly contentHash: string;
  readonly etag?: string;
  readonly lastModified?: Date;
}

export interface PutOptions {
  readonly contentType: string;
  readonly cacheControl?: string;
  /** Content-addressed => safe to cache forever. */
  readonly immutable?: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface SignedUrl {
  readonly url: string;
  readonly method: 'GET' | 'PUT';
  readonly expiresAt: Date;
  /** Headers the caller must send with the request (mainly for PUT). */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface SignOptions {
  /** Bounded by config max. */
  readonly expiresInSeconds: number;
  /** Content-Disposition filename for GET. */
  readonly downloadFilename?: string;
  /** Required for PUT. */
  readonly contentType?: string;
}
