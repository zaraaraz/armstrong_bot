import { createHash } from 'node:crypto';

import { namespaceSegment, StorageNamespace } from './storage-namespace';

/** Lowercase sha256 hex digest of a buffer — the content-addressing anchor. */
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Builds the backend-relative, content-addressed key for an object:
 * `{guildId|global}/{namespaceSegment}/{hash}`. Pure; performs no I/O.
 */
export function buildObjectKey(
  guildId: string | null,
  ns: StorageNamespace,
  hash: string,
): string {
  return `${guildId ?? 'global'}/${namespaceSegment(ns)}/${hash}`;
}
