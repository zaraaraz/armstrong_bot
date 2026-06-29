/** Keys whose values are scrubbed before anything is logged. Case-insensitive. */
export const REDACTED_KEYS: readonly string[] = [
  'password',
  'token',
  'rconPassword',
  'authorization',
  'apiKey',
  'hashedKey',
  'secret',
];

const REDACTED_PLACEHOLDER = '[REDACTED]';
const redactedSet = new Set(REDACTED_KEYS.map((k) => k.toLowerCase()));

function isRedactedKey(key: string): boolean {
  return redactedSet.has(key.toLowerCase());
}

/**
 * Returns a deep copy of `input` with sensitive values replaced by
 * `[REDACTED]`. Safe against cycles. Use as a Pino log serializer so secrets
 * and raw API keys never reach the logs (spec §12).
 */
export function redact<T>(input: T, seen = new WeakSet<object>()): T {
  if (input === null || typeof input !== 'object') return input;

  if (seen.has(input)) return input;
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map((item: unknown) => redact(item, seen)) as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = isRedactedKey(key) ? REDACTED_PLACEHOLDER : redact(value, seen);
  }
  return out as T;
}
