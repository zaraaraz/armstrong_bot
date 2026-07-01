/**
 * The logical namespaces a stored object can belong to. Mirrors the Prisma
 * `StorageNamespace` enum exactly; it is part of the public contract (DTOs and
 * events expose these literals) so the values are stable.
 */
export enum StorageNamespace {
  Transcripts = 'TRANSCRIPTS',
  Backups = 'BACKUPS',
  RankCards = 'RANK_CARDS',
  Exports = 'EXPORTS',
  Plugin = 'PLUGIN',
}

/** Lowercase, URL-safe path segment for each namespace. */
const NAMESPACE_SEGMENTS: Readonly<Record<StorageNamespace, string>> = {
  [StorageNamespace.Transcripts]: 'transcripts',
  [StorageNamespace.Backups]: 'backups',
  [StorageNamespace.RankCards]: 'rank-cards',
  [StorageNamespace.Exports]: 'exports',
  [StorageNamespace.Plugin]: 'plugin',
};

/**
 * The path segment used when building content-addressed keys, e.g. `RANK_CARDS`
 * becomes `rank-cards` in `{guild|global}/{segment}/{hash}`.
 */
export function namespaceSegment(ns: StorageNamespace): string {
  return NAMESPACE_SEGMENTS[ns];
}
