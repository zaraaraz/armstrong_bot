import {
  resolveStorageGlobalConfig,
  resolveStorageGuildConfig,
} from './storage.config';

describe('storage.config', () => {
  describe('resolveStorageGlobalConfig', () => {
    it('applies defaults when the environment is empty', () => {
      const cfg = resolveStorageGlobalConfig({});
      expect(cfg.driver).toBe('local');
      expect(cfg.maxSignedUrlSeconds).toBe(900);
      expect(cfg.defaultQuotaBytes).toBe(1_073_741_824);
      expect(cfg.s3.forcePathStyle).toBe(true);
    });

    it('reads and coerces environment overrides', () => {
      const cfg = resolveStorageGlobalConfig({
        STORAGE_DRIVER: 's3',
        STORAGE_LOCAL_ROOT: '/tmp/storage',
        STORAGE_MAX_SIGNED_URL_SECONDS: '120',
        STORAGE_DEFAULT_QUOTA_BYTES: '1024',
        STORAGE_S3_BUCKET: 'my-bucket',
        STORAGE_S3_FORCE_PATH_STYLE: 'false',
      });
      expect(cfg.driver).toBe('s3');
      expect(cfg.localRoot).toBe('/tmp/storage');
      expect(cfg.maxSignedUrlSeconds).toBe(120);
      expect(cfg.defaultQuotaBytes).toBe(1024);
      expect(cfg.s3.bucket).toBe('my-bucket');
      expect(cfg.s3.forcePathStyle).toBe(false);
    });

    it('falls back to defaults for blank or non-numeric numbers', () => {
      const cfg = resolveStorageGlobalConfig({
        STORAGE_MAX_SIGNED_URL_SECONDS: '',
        STORAGE_DEFAULT_QUOTA_BYTES: 'not-a-number',
      });
      expect(cfg.maxSignedUrlSeconds).toBe(900);
      expect(cfg.defaultQuotaBytes).toBe(1_073_741_824);
    });

    it('prefers STORAGE_PUBLIC_BASE_URL over DASHBOARD_BASE_URL', () => {
      const cfg = resolveStorageGlobalConfig({
        STORAGE_PUBLIC_BASE_URL: 'https://cdn.example',
        DASHBOARD_BASE_URL: 'https://dash.example',
      });
      expect(cfg.publicBaseUrl).toBe('https://cdn.example');

      const fallback = resolveStorageGlobalConfig({
        DASHBOARD_BASE_URL: 'https://dash.example',
      });
      expect(fallback.publicBaseUrl).toBe('https://dash.example');
    });
  });

  describe('resolveStorageGuildConfig', () => {
    it('uses the global default quota when there is no override', () => {
      expect(resolveStorageGuildConfig(2048).quotaBytes).toBe(2048);
    });

    it('applies a guild override on top of the default', () => {
      expect(
        resolveStorageGuildConfig(2048, { quotaBytes: 512 }).quotaBytes,
      ).toBe(512);
    });
  });
});
