import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { EncryptionService } from './encryption.service';

function makeService(masterKey?: string): EncryptionService {
  const map: Record<string, string | undefined> = {
    GHOST_MASTER_KEY_ENV: 'GHOST_MASTER_KEY',
    GHOST_MASTER_KEY: masterKey,
  };
  const config = {
    get: (key: string, fallback?: string) => map[key] ?? fallback,
  } as unknown as ConfigService;
  const svc = new EncryptionService(config);
  svc.onModuleInit();
  return svc;
}

describe('EncryptionService', () => {
  const key32 = randomBytes(32).toString('base64');

  it('round-trips AES-256-GCM encryption', () => {
    const svc = makeService(key32);
    const plaintext = 'super-secret-rcon-password';
    const encrypted = svc.encrypt(plaintext);

    expect(encrypted).not.toContain(plaintext);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(svc.decrypt(encrypted)).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const svc = makeService(key32);
    expect(svc.encrypt('x')).not.toBe(svc.encrypt('x'));
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const svc = makeService(key32);
    const encrypted = svc.encrypt('hello');
    const [iv, tag] = encrypted.split(':');
    const tampered = [iv, tag, Buffer.from('evil').toString('base64')].join(
      ':',
    );
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it('throws on a malformed payload', () => {
    const svc = makeService(key32);
    expect(() => svc.decrypt('not-a-valid-payload')).toThrow();
  });

  it('rejects a master key of the wrong length', () => {
    expect(() => makeService(randomBytes(16).toString('base64'))).toThrow();
  });

  it('hashes and verifies a secret', async () => {
    const svc = makeService(key32);
    const hash = await svc.hash('hunter2');

    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('hunter2');
    expect(await svc.verify('hunter2', hash)).toBe(true);
    expect(await svc.verify('wrong', hash)).toBe(false);
  });

  it('returns false verifying against a malformed hash', async () => {
    const svc = makeService(key32);
    expect(await svc.verify('x', 'garbage')).toBe(false);
  });
});
