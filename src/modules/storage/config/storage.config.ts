import { z } from 'zod';

/** Global (process-wide, ENV-sourced) storage configuration. */
export const storageGlobalConfigSchema = z.object({
  /** Active driver: local (default), s3, or null (discard — tests). */
  driver: z.enum(['local', 's3', 'null']).default('local'),
  /** Root dir for the local driver. */
  localRoot: z.string().default('/srv/bots/armstrong/storage'),
  /** Public base URL the local signed-proxy links point at. */
  publicBaseUrl: z.string().default('http://localhost:3000'),
  /** HMAC secret for local signed URLs. */
  signingSecret: z.string().default('change-me-storage-signing-secret'),
  /** Max lifetime (seconds) a signed URL may request. */
  maxSignedUrlSeconds: z.number().int().min(30).max(604_800).default(900),
  /** Per-guild quota in bytes (0 = unlimited). */
  defaultQuotaBytes: z.number().int().min(0).default(1_073_741_824), // 1 GiB
  /** S3-compatible settings (used when driver = s3). */
  s3: z
    .object({
      endpoint: z.string().default(''),
      region: z.string().default('auto'),
      bucket: z.string().default(''),
      accessKeyId: z.string().default(''),
      secretAccessKey: z.string().default(''),
      forcePathStyle: z.boolean().default(true),
    })
    .default({
      endpoint: '',
      region: 'auto',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      forcePathStyle: true,
    }),
});

/** Per-guild storage overrides. */
export const storageGuildConfigSchema = z.object({
  quotaBytes: z.number().int().min(0).default(1_073_741_824),
});

export type StorageGlobalConfig = z.infer<typeof storageGlobalConfigSchema>;
export type StorageGuildConfig = z.infer<typeof storageGuildConfigSchema>;

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function resolveStorageGlobalConfig(
  env: Record<string, string | undefined>,
): StorageGlobalConfig {
  return storageGlobalConfigSchema.parse({
    driver: env['STORAGE_DRIVER'],
    localRoot: env['STORAGE_LOCAL_ROOT'],
    publicBaseUrl: env['STORAGE_PUBLIC_BASE_URL'] ?? env['DASHBOARD_BASE_URL'],
    signingSecret: env['STORAGE_SIGNING_SECRET'],
    maxSignedUrlSeconds: num(env['STORAGE_MAX_SIGNED_URL_SECONDS']),
    defaultQuotaBytes: num(env['STORAGE_DEFAULT_QUOTA_BYTES']),
    s3: {
      endpoint: env['STORAGE_S3_ENDPOINT'],
      region: env['STORAGE_S3_REGION'],
      bucket: env['STORAGE_S3_BUCKET'],
      accessKeyId: env['STORAGE_S3_ACCESS_KEY_ID'],
      secretAccessKey: env['STORAGE_S3_SECRET_ACCESS_KEY'],
      forcePathStyle: env['STORAGE_S3_FORCE_PATH_STYLE'] !== 'false',
    },
  });
}

export function resolveStorageGuildConfig(
  defaultQuota: number,
  override?: Partial<StorageGuildConfig>,
): StorageGuildConfig {
  return storageGuildConfigSchema.parse({
    quotaBytes: override?.quotaBytes ?? defaultQuota,
  });
}
