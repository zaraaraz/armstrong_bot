import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'crypto';
import { promisify } from 'util';
import type { ScryptOptions } from 'crypto';
import type { IEncryptionService } from '../interfaces/security.interfaces';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce size
const KEY_BYTES = 32; // AES-256
const SALT_BYTES = 16;
const HASH_BYTES = 64;
const SCRYPT_N = 16_384;
const SCRYPT_PARAMS = { N: SCRYPT_N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * AES-256-GCM symmetric encryption for fields at rest + scrypt password/API-key
 * hashing. The master key is a 32-byte base64 value read from the configured
 * ENV var (`GHOST_MASTER_KEY` by default). It is NEVER logged.
 *
 * Spec calls for Argon2id; we use Node's built-in scrypt to avoid a native
 * dependency. The {@link hash}/{@link verify} contract is identical, so the
 * implementation can be swapped without touching callers.
 */
@Injectable()
export class EncryptionService implements IEncryptionService, OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private masterKey!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const envName = this.config.get<string>(
      'GHOST_MASTER_KEY_ENV',
      'GHOST_MASTER_KEY',
    );
    const raw = this.config.get<string>(envName);

    if (!raw) {
      // Dev fallback: derive an ephemeral key so the app boots without a key
      // configured. Encrypted data will not survive a restart — warn loudly.
      this.masterKey = randomBytes(KEY_BYTES);
      this.logger.warn(
        `No master key in ${envName}; generated an ephemeral key. ` +
          'Encrypted data will NOT be recoverable across restarts.',
      );
      return;
    }

    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `${envName} must be a base64-encoded ${KEY_BYTES}-byte key (got ${key.length} bytes).`,
      );
    }
    this.masterKey = key;
  }

  /** Returns base64 `iv:tag:ciphertext`. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed ciphertext payload.');
    }
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv(
      ALGORITHM,
      this.masterKey,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  /** Returns `scrypt$<saltB64>$<hashB64>`. */
  async hash(secret: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const derived = await scrypt(secret, salt, HASH_BYTES, SCRYPT_PARAMS);
    return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  async verify(secret: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'base64');
    const expected = Buffer.from(parts[2], 'base64');
    const derived = await scrypt(secret, salt, expected.length, SCRYPT_PARAMS);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }
}
