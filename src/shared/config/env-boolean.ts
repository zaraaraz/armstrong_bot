import { z } from 'zod';

/**
 * Parses a boolean from an environment variable.
 *
 * `z.coerce.boolean()` must NOT be used for env flags: it applies JavaScript's
 * `Boolean(value)`, so the string `"false"` (any non-empty string) coerces to
 * `true`. This helper treats `"false"/"0"/"no"/"off"/""` as false and
 * `"true"/"1"/"yes"/"on"` as true, case-insensitively. Real booleans pass
 * through unchanged.
 *
 * @param defaultValue value used when the variable is unset.
 */
export function envBoolean(defaultValue: boolean): z.ZodType<boolean> {
  return z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      const s = v.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(s)) return true;
      if (['false', '0', 'no', 'off', ''].includes(s)) return false;
      return defaultValue;
    });
}
