import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { SignatureInvalidError } from '../domain/errors/signature-invalid.error';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import {
  SignatureVerifier,
  type VerificationContext,
} from './signature-verifier.interface';

const SIGNATURE_HEADER = 'stripe-signature';

/** Parsed `Stripe-Signature` header: timestamp + one-or-more v1 candidates. */
interface StripeSignatureParts {
  /** Parsed numeric timestamp, used only for the tolerance check. */
  readonly timestamp: number;
  /** Exact `t=` value as received, used to reconstruct the signed payload. */
  readonly timestampRaw: string;
  readonly v1: readonly string[];
}

/**
 * Stripe signature verifier. Stripe sends `Stripe-Signature:
 * t=<unix>,v1=<hex>[,v1=<hex>...]`. The signed payload is `${t}.${rawBody}`,
 * HMAC-SHA256 keyed by the endpoint's signing secret. Verification rejects a
 * timestamp outside `toleranceSeconds` (replay protection) and accepts if ANY
 * provided `v1` candidate matches in constant time. Any failure throws
 * {@link SignatureInvalidError} without leaking the secret or body.
 */
@Injectable()
export class StripeVerifier extends SignatureVerifier {
  readonly provider = WebhookProvider.Stripe;

  verify(ctx: VerificationContext): Promise<void> {
    // Fail closed on a missing/blank secret rather than computing an HMAC keyed
    // by an empty key (Node accepts that, producing a forgeable digest).
    if (!ctx.signingSecret) {
      throw new SignatureInvalidError('signing secret not configured');
    }
    const header = ctx.headers[SIGNATURE_HEADER];
    if (!header) {
      throw new SignatureInvalidError('missing signature header');
    }
    const parts = parseSignatureHeader(header);

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - parts.timestamp) > ctx.toleranceSeconds) {
      throw new SignatureInvalidError('timestamp outside tolerance');
    }

    // Sign over the exact received bytes: `${t}.` + rawBody, concatenated as
    // Buffers so no UTF-8 re-encoding can alter the hashed content. The raw `t`
    // string (not the normalized number) reproduces exactly what Stripe signed.
    const signedPayload = Buffer.concat([
      Buffer.from(`${parts.timestampRaw}.`, 'utf8'),
      ctx.rawBody,
    ]);
    const expected = createHmac('sha256', ctx.signingSecret)
      .update(signedPayload)
      .digest();

    const matched = parts.v1.some((candidate) =>
      hexMatches(expected, candidate),
    );
    if (!matched) {
      throw new SignatureInvalidError('signature mismatch');
    }
    return Promise.resolve();
  }
}

/** Parses `t=<unix>,v1=<hex>[,v1=<hex>...]`; throws on missing t or v1. */
function parseSignatureHeader(header: string): StripeSignatureParts {
  let timestamp: number | undefined;
  let timestampRaw: string | undefined;
  const v1: string[] = [];
  for (const segment of header.split(',')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const key = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (key === 't') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) {
        timestamp = parsed;
        timestampRaw = value;
      }
    } else if (key === 'v1' && value.length > 0) {
      v1.push(value);
    }
  }
  if (timestamp === undefined || timestampRaw === undefined) {
    throw new SignatureInvalidError('malformed signature header');
  }
  if (v1.length === 0) {
    throw new SignatureInvalidError('malformed signature header');
  }
  return { timestamp, timestampRaw, v1 };
}

/**
 * Constant-time compare of an expected digest against a provided hex string.
 * Guards equal length BEFORE calling timingSafeEqual (which throws on
 * unequal-length buffers). Returns false rather than throwing so the caller can
 * try every `v1` candidate.
 */
function hexMatches(expected: Buffer, providedHex: string): boolean {
  const provided = Buffer.from(providedHex, 'hex');
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}
