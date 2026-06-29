/** Strategy used to derive the rate-limit bucket key. */
export type RateLimitBy = 'user' | 'guild' | 'ip' | 'api-key' | 'global';

export interface RateLimitOptions {
  /** Allowed actions within the window. */
  readonly points: number;
  /** Window length in seconds. */
  readonly duration: number;
  /** Key derivation strategy. */
  readonly by: RateLimitBy;
  /** Optional block duration after exhaustion (seconds). */
  readonly blockFor?: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterMs: number;
}

export interface IRateLimitService {
  consume(key: string, options: RateLimitOptions): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

export interface ICooldownService {
  /** Returns 0 when ready, otherwise the milliseconds left. */
  check(scope: string, userId: string, seconds: number): Promise<number>;
  start(scope: string, userId: string, seconds: number): Promise<void>;
}

export interface IEncryptionService {
  /** AES-256-GCM. Returns base64 `iv:tag:ciphertext`. */
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
  /** Password / API-key hashing (scrypt). */
  hash(secret: string): Promise<string>;
  verify(secret: string, hash: string): Promise<boolean>;
}

export interface ISecretProvider {
  get(name: string): Promise<string | undefined>;
  require(name: string): Promise<string>;
}

export interface ISanitizer {
  stripMentions(input: string): string;
  escapeMarkdown(input: string): string;
  sanitizeHtml(input: string): string;
  sanitizeFilename(input: string): string;
}

/** DI token for the pluggable secret provider. */
export const SECRET_PROVIDER = Symbol('SECRET_PROVIDER');
