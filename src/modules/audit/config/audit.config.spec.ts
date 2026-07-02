import { describe, expect, it } from 'vitest';
import {
  resolveAuditGlobalConfig,
  resolveAuditGuildConfig,
} from './audit.config';

describe('resolveAuditGlobalConfig', () => {
  it('applies spec defaults with an empty environment', () => {
    const cfg = resolveAuditGlobalConfig({});
    expect(cfg.ingestEnabled).toBe(true);
    expect(cfg.ingestConcurrency).toBe(4);
    expect(cfg.hashAlgorithm).toBe('sha256');
    expect(cfg.denyActionPrefixes).toEqual([
      'audit.entry.recorded',
      'system.heartbeat',
      'cache.hit',
    ]);
    expect(cfg.redactMetadataKeys).toContain('password');
    expect(cfg.maxPageSize).toBe(100);
    expect(cfg.queryCacheTtlSeconds).toBe(15);
  });

  it('reads AUDIT_* env overrides, including csv lists and numbers', () => {
    const cfg = resolveAuditGlobalConfig({
      AUDIT_INGEST_ENABLED: 'false',
      AUDIT_INGEST_CONCURRENCY: '8',
      AUDIT_HASH_ALGORITHM: 'sha512',
      AUDIT_DENY_ACTION_PREFIXES: 'audit.entry.recorded, cache.',
      AUDIT_REDACT_METADATA_KEYS: 'apikey,password',
      AUDIT_MAX_PAGE_SIZE: '250',
      AUDIT_QUERY_CACHE_TTL_SECONDS: '0',
    });
    expect(cfg.ingestEnabled).toBe(false);
    expect(cfg.ingestConcurrency).toBe(8);
    expect(cfg.hashAlgorithm).toBe('sha512');
    expect(cfg.denyActionPrefixes).toEqual(['audit.entry.recorded', 'cache.']);
    expect(cfg.redactMetadataKeys).toEqual(['apikey', 'password']);
    expect(cfg.maxPageSize).toBe(250);
    expect(cfg.queryCacheTtlSeconds).toBe(0);
  });

  it('rejects out-of-range values instead of clamping silently', () => {
    expect(() =>
      resolveAuditGlobalConfig({ AUDIT_INGEST_CONCURRENCY: '999' }),
    ).toThrow();
    expect(() =>
      resolveAuditGlobalConfig({ AUDIT_HASH_ALGORITHM: 'md5' }),
    ).toThrow();
  });
});

describe('resolveAuditGuildConfig', () => {
  it('defaults to 365 days with archive-before-delete in ndjson', () => {
    const cfg = resolveAuditGuildConfig({});
    expect(cfg.retentionDays).toBe(365);
    expect(cfg.archiveBeforeDelete).toBe(true);
    expect(cfg.archiveFormat).toBe('ndjson');
    expect(cfg.denyActionPrefixes).toEqual([]);
  });

  it('layers guild overrides on top of env defaults', () => {
    const cfg = resolveAuditGuildConfig(
      { AUDIT_RETENTION_DAYS: '90' },
      { archiveFormat: 'csv' },
    );
    expect(cfg.retentionDays).toBe(90);
    expect(cfg.archiveFormat).toBe('csv');
  });

  it('guild override wins over the env default', () => {
    const cfg = resolveAuditGuildConfig(
      { AUDIT_RETENTION_DAYS: '90' },
      { retentionDays: 400 },
    );
    expect(cfg.retentionDays).toBe(400);
  });

  it('enforces the 30..3650 day bounds', () => {
    expect(() => resolveAuditGuildConfig({}, { retentionDays: 10 })).toThrow();
    expect(() =>
      resolveAuditGuildConfig({}, { retentionDays: 5000 }),
    ).toThrow();
  });
});
