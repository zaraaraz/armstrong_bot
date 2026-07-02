/**
 * Deterministic JSON serialisation for hashing: object keys are sorted
 * recursively, so two structurally equal values always produce the same
 * string regardless of insertion order. Non-JSON primitives are normalised
 * (bigint -> string, Date -> ISO, undefined -> null) instead of throwing so
 * arbitrary event payloads can be hashed safely.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = normalise(record[key]);
    }
    return out;
  }
  // functions/symbols carry no auditable content
  return null;
}
