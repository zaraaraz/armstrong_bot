import { z } from 'zod';

/**
 * Global (process-wide) audit settings, sourced from ENV. `hashAlgorithm`
 * and ingest tuning are deliberately global-only: a per-guild algorithm
 * would fork the hash chain semantics.
 */
export const auditGlobalConfigSchema = z.object({
  ingestEnabled: z.boolean().default(true),
  ingestConcurrency: z.number().int().min(1).max(50).default(4),
  hashAlgorithm: z.enum(['sha256', 'sha512']).default('sha256'),
  denyActionPrefixes: z
    .array(z.string())
    .default(['audit.entry.recorded', 'system.heartbeat', 'cache.hit']),
  redactMetadataKeys: z
    .array(z.string())
    .default(['password', 'token', 'secret', 'authorization']),
  archiveDir: z.string().default('/srv/bots/armstrong/audit-archives'),
  retentionCron: z.string().default('0 4 * * *'), // daily, 04:00
  maxPageSize: z.number().int().min(1).max(500).default(100),
  queryCacheTtlSeconds: z.number().int().min(0).max(300).default(15),
});

export type AuditGlobalConfig = z.infer<typeof auditGlobalConfigSchema>;

/** Per-guild overridable retention policy (GuildConfig.settings.audit). */
export const auditGuildConfigSchema = z.object({
  retentionDays: z.number().int().min(30).max(3650).default(365),
  archiveBeforeDelete: z.boolean().default(true),
  archiveFormat: z.enum(['json', 'ndjson', 'csv']).default('ndjson'),
  denyActionPrefixes: z.array(z.string()).default([]),
});

export type AuditGuildConfig = z.infer<typeof auditGuildConfigSchema>;

function num(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return value !== 'false' && value !== '0';
}

function csv(value: string | undefined): string[] | undefined {
  if (value === undefined || value === '') return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function resolveAuditGlobalConfig(
  env: Record<string, string | undefined>,
): AuditGlobalConfig {
  return auditGlobalConfigSchema.parse({
    ingestEnabled: bool(env['AUDIT_INGEST_ENABLED']),
    ingestConcurrency: num(env['AUDIT_INGEST_CONCURRENCY']),
    hashAlgorithm: env['AUDIT_HASH_ALGORITHM'],
    denyActionPrefixes: csv(env['AUDIT_DENY_ACTION_PREFIXES']),
    redactMetadataKeys: csv(env['AUDIT_REDACT_METADATA_KEYS']),
    archiveDir: env['AUDIT_ARCHIVE_DIR'],
    retentionCron: env['AUDIT_RETENTION_CRON'],
    maxPageSize: num(env['AUDIT_MAX_PAGE_SIZE']),
    queryCacheTtlSeconds: num(env['AUDIT_QUERY_CACHE_TTL_SECONDS']),
  });
}

/**
 * Guild resolution: ENV-provided defaults layered under the guild's own
 * `GuildConfig.settings.audit` override blob.
 */
export function resolveAuditGuildConfig(
  env: Record<string, string | undefined>,
  override?: Partial<AuditGuildConfig>,
): AuditGuildConfig {
  return auditGuildConfigSchema.parse({
    retentionDays: override?.retentionDays ?? num(env['AUDIT_RETENTION_DAYS']),
    archiveBeforeDelete:
      override?.archiveBeforeDelete ?? bool(env['AUDIT_ARCHIVE_BEFORE_DELETE']),
    archiveFormat: override?.archiveFormat ?? env['AUDIT_ARCHIVE_FORMAT'],
    denyActionPrefixes: override?.denyActionPrefixes,
  });
}
