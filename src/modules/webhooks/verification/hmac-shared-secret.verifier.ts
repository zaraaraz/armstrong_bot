import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { SignatureInvalidError } from '../domain/errors/signature-invalid.error';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import {
  SignatureVerifier,
  type VerificationContext,
} from './signature-verifier.interface';

const SIGNATURE_PREFIX = 'sha256=';
/** Accepted signature headers, in priority order. */
const SIGNATURE_HEADERS = ['x-signature-256', 'x-webhook-signature'] as const;

/**
 * Shared-secret HMAC verifier used by the simple providers (FiveM panels and
 * arbitrary custom sources) that sign the raw body with HMAC-SHA256 keyed by a
 * shared secret. The hex signature arrives in `X-Signature-256` or
 * `X-Webhook-Signature`, optionally `sha256=`-prefixed. Comparison is
 * constant-time; any failure throws {@link SignatureInvalidError} without
 * leaking the secret or body.
 *
 * A verifier has a single `provider`, so the two providers are exposed as the
 * tiny {@link FiveMVerifier} / {@link CustomVerifier} subclasses below; the
 * verification logic lives here once.
 */
export abstract class HmacSharedSecretVerifier extends SignatureVerifier {
  verify(ctx: VerificationContext): Promise<void> {
    if (!ctx.signingSecret) {
      throw new SignatureInvalidError('signing secret not configured');
    }
    const providedHex = extractSignature(ctx.headers);
    if (providedHex === undefined) {
      throw new SignatureInvalidError('missing or malformed signature header');
    }
    const expected = createHmac('sha256', ctx.signingSecret)
      .update(ctx.rawBody)
      .digest();
    const provided = Buffer.from(providedHex, 'hex');
    if (provided.length !== expected.length) {
      throw new SignatureInvalidError('signature mismatch');
    }
    if (!timingSafeEqual(expected, provided)) {
      throw new SignatureInvalidError('signature mismatch');
    }
    return Promise.resolve();
  }
}

/**
 * Reads the first present signature header and strips an optional `sha256=`
 * prefix. Returns the hex string, or undefined when no candidate header carries
 * a value.
 */
function extractSignature(
  headers: Readonly<Record<string, string | undefined>>,
): string | undefined {
  for (const name of SIGNATURE_HEADERS) {
    const raw = headers[name];
    if (raw === undefined) continue;
    const value = raw.startsWith(SIGNATURE_PREFIX)
      ? raw.slice(SIGNATURE_PREFIX.length)
      : raw;
    if (value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/** FiveM panel webhooks: shared-secret HMAC over the raw body. */
@Injectable()
export class FiveMVerifier extends HmacSharedSecretVerifier {
  readonly provider = WebhookProvider.FiveM;
}

/** Arbitrary custom sources: shared-secret HMAC over the raw body. */
@Injectable()
export class CustomVerifier extends HmacSharedSecretVerifier {
  readonly provider = WebhookProvider.Custom;
}
