import { buildObjectKey, sha256Hex } from './content-hash.util';
import { StorageNamespace } from './storage-namespace';

describe('content-hash.util', () => {
  describe('sha256Hex', () => {
    it('is a stable, lowercase 64-char hex digest for known bytes', () => {
      // Reference vector: sha256("") — the empty input digest.
      expect(sha256Hex(Buffer.alloc(0))).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
      // Reference vector: sha256("abc").
      expect(sha256Hex(Buffer.from('abc'))).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('is deterministic — identical bytes hash identically (dedupe anchor)', () => {
      const a = sha256Hex(Buffer.from('the same rank-card background'));
      const b = sha256Hex(Buffer.from('the same rank-card background'));
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('differs when a single byte changes', () => {
      expect(sha256Hex(Buffer.from('payload-a'))).not.toBe(
        sha256Hex(Buffer.from('payload-b')),
      );
    });
  });

  describe('buildObjectKey', () => {
    const hash =
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

    it('scopes to the guild id when one is given: {guildId}/{ns}/{hash}', () => {
      expect(buildObjectKey('123', StorageNamespace.Transcripts, hash)).toBe(
        `123/transcripts/${hash}`,
      );
    });

    it('uses the "global" segment when guildId is null', () => {
      expect(buildObjectKey(null, StorageNamespace.Backups, hash)).toBe(
        `global/backups/${hash}`,
      );
    });

    it('maps each namespace to its URL-safe segment', () => {
      expect(buildObjectKey('g', StorageNamespace.RankCards, hash)).toBe(
        `g/rank-cards/${hash}`,
      );
      expect(buildObjectKey('g', StorageNamespace.Exports, hash)).toBe(
        `g/exports/${hash}`,
      );
      expect(buildObjectKey('g', StorageNamespace.Plugin, hash)).toBe(
        `g/plugin/${hash}`,
      );
    });
  });
});
