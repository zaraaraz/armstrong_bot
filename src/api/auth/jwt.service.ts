import { createHmac, timingSafeEqual } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api.config';

export interface JwtClaims {
  readonly sub: string;
  readonly type: 'user' | 'service';
  readonly name: string;
  /** Permission claims granted to this token. */
  readonly scopes: readonly string[];
  /** Guilds this token may act within (empty => global). */
  readonly guilds: readonly string[];
  readonly iss: string;
  readonly iat: number;
  readonly exp: number;
}

export type JwtSignInput = Omit<JwtClaims, 'iss' | 'iat' | 'exp'>;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Minimal, dependency-free HS256 JWT issuer/verifier. Used for short-lived
 * service/internal tokens. Browser/dashboard auth uses sessions, not JWT.
 */
@Injectable()
export class JwtService {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  sign(
    input: JwtSignInput,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: JwtClaims = {
      ...input,
      iss: this.config.jwt.issuer,
      iat: nowSeconds,
      exp: nowSeconds + this.config.jwt.accessTtlSeconds,
    };
    const head = b64url(JSON.stringify(header));
    const body = b64url(JSON.stringify(payload));
    const signature = this.signature(`${head}.${body}`);
    return `${head}.${body}.${signature}`;
  }

  /** Returns the verified claims or null if the token is invalid/expired. */
  verify(
    token: string,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): JwtClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [head, body, signature] = parts;

    const expected = this.signature(`${head}.${body}`);
    if (!this.constantTimeEquals(signature, expected)) return null;

    try {
      const claims = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as JwtClaims;
      if (claims.iss !== this.config.jwt.issuer) return null;
      if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
        return null;
      }
      return claims;
    } catch {
      return null;
    }
  }

  private signature(data: string): string {
    return createHmac('sha256', this.config.jwt.secret)
      .update(data)
      .digest('base64url');
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
