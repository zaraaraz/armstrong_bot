import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { SignatureInvalidError } from '../domain/errors/signature-invalid.error';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import {
  SignatureVerifier,
  type VerificationContext,
} from './signature-verifier.interface';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';

/**
 * GitHub signature verifier. GitHub sends `X-Hub-Signature-256:
 * sha256=<hex>`, an HMAC-SHA256 of the exact raw request body keyed by the
 * endpoint's signing secret. Comparison is constant-time; any failure (missing
 * or malformed header, length mismatch, digest mismatch) throws
 * {@link SignatureInvalidError} with a reason that never leaks the secret or
 * body.
 */
@Injectable()
export class GithubVerifier extends SignatureVerifier {
  readonly provider = WebhookProvider.GitHub;

  verify(ctx: VerificationContext): Promise<void> {
    if (!ctx.signingSecret) {
      throw new SignatureInvalidError('signing secret not configured');
    }
    const header = ctx.headers[SIGNATURE_HEADER];
    if (!header || !header.startsWith(SIGNATURE_PREFIX)) {
      throw new SignatureInvalidError('missing or malformed signature header');
    }
    const providedHex = header.slice(SIGNATURE_PREFIX.length);
    const expected = createHmac('sha256', ctx.signingSecret)
      .update(ctx.rawBody)
      .digest();
    assertHexMatches(expected, providedHex);
    return Promise.resolve();
  }
}

/**
 * Constant-time compare of an expected digest against a provided hex string.
 * Decodes the hex first, guards equal length BEFORE calling timingSafeEqual
 * (which throws on unequal-length buffers), then compares in constant time.
 */
function assertHexMatches(expected: Buffer, providedHex: string): void {
  const provided = Buffer.from(providedHex, 'hex');
  // A partial/odd hex decode yields fewer bytes; the length guard rejects it.
  if (provided.length !== expected.length) {
    throw new SignatureInvalidError('signature mismatch');
  }
  if (!timingSafeEqual(expected, provided)) {
    throw new SignatureInvalidError('signature mismatch');
  }
}
