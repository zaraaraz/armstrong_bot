import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import { StripeVerifier } from './stripe.verifier';
import { SignatureInvalidError } from '../domain/errors/signature-invalid.error';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import type { VerificationContext } from './signature-verifier.interface';

const SECRET = 'whsec_test_secret';
const TOLERANCE = 300;

/** HMAC-SHA256 over `${t}.` + rawBody, as hex — mirrors what Stripe signs. */
function signHex(t: number, body: Buffer, secret = SECRET): string {
  const signed = Buffer.concat([Buffer.from(`${t}.`), body]);
  return createHmac('sha256', secret).update(signed).digest('hex');
}

/** Builds a full VerificationContext for one delivery. */
function ctxFor(
  header: string | undefined,
  body: Buffer,
  overrides: Partial<VerificationContext> = {},
): VerificationContext {
  return {
    rawBody: body,
    headers: { 'stripe-signature': header },
    signingSecret: SECRET,
    toleranceSeconds: TOLERANCE,
    ...overrides,
  };
}

describe('StripeVerifier', () => {
  let verifier: StripeVerifier;

  beforeEach(() => {
    verifier = new StripeVerifier();
  });

  it('exposes the Stripe provider', () => {
    expect(verifier.provider).toBe(WebhookProvider.Stripe);
  });

  it('resolves for a valid current-timestamp signature', async () => {
    const t = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    const header = `t=${t},v1=${signHex(t, body)}`;
    await expect(
      verifier.verify(ctxFor(header, body)),
    ).resolves.toBeUndefined();
  });

  it('throws when the timestamp is expired beyond tolerance', () => {
    const t = Math.floor(Date.now() / 1000) - 10000;
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    const header = `t=${t},v1=${signHex(t, body)}`;
    expect(() => verifier.verify(ctxFor(header, body))).toThrow(
      SignatureInvalidError,
    );
  });

  it('throws when the timestamp is in the future beyond tolerance', () => {
    const t = Math.floor(Date.now() / 1000) + 10000;
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    const header = `t=${t},v1=${signHex(t, body)}`;
    expect(() => verifier.verify(ctxFor(header, body))).toThrow(
      SignatureInvalidError,
    );
  });

  it('accepts a timestamp just inside tolerance (fresh, non-current)', async () => {
    const t = Math.floor(Date.now() / 1000) - (TOLERANCE - 5);
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    const header = `t=${t},v1=${signHex(t, body)}`;
    await expect(
      verifier.verify(ctxFor(header, body)),
    ).resolves.toBeUndefined();
  });

  it('throws on a tampered body (signature mismatch)', () => {
    const t = Math.floor(Date.now() / 1000);
    const signedBody = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    const header = `t=${t},v1=${signHex(t, signedBody)}`;
    const tamperedBody = Buffer.from(JSON.stringify({ id: 'evt_2' }));
    expect(() => verifier.verify(ctxFor(header, tamperedBody))).toThrow(
      SignatureInvalidError,
    );
  });

  it('throws when the signature was made with the wrong secret', () => {
    const t = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    const header = `t=${t},v1=${signHex(t, body, 'a_different_secret')}`;
    expect(() => verifier.verify(ctxFor(header, body))).toThrow(
      SignatureInvalidError,
    );
  });

  it('resolves when one of multiple v1 candidates is valid', async () => {
    const t = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    const header = `t=${t},v1=deadbeef,v1=${signHex(t, body)}`;
    await expect(
      verifier.verify(ctxFor(header, body)),
    ).resolves.toBeUndefined();
  });

  it('throws when no v1 candidate matches', () => {
    const t = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    const header = `t=${t},v1=deadbeef,v1=cafebabe`;
    expect(() => verifier.verify(ctxFor(header, body))).toThrow(
      SignatureInvalidError,
    );
  });

  it('throws when the signature header is missing', () => {
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    expect(() => verifier.verify(ctxFor(undefined, body))).toThrow(
      SignatureInvalidError,
    );
  });

  it('throws on a malformed header with no t', () => {
    const t = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    const header = `v1=${signHex(t, body)}`;
    expect(() => verifier.verify(ctxFor(header, body))).toThrow(
      SignatureInvalidError,
    );
  });

  it('throws on a malformed header with no v1', () => {
    const t = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    const header = `t=${t}`;
    expect(() => verifier.verify(ctxFor(header, body))).toThrow(
      SignatureInvalidError,
    );
  });

  it('throws on a completely garbage header', () => {
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    expect(() => verifier.verify(ctxFor('not-a-signature', body))).toThrow(
      SignatureInvalidError,
    );
  });

  it('fails closed when the signing secret is empty', () => {
    const t = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    // Sign with an empty key so the digest itself is internally consistent;
    // the verifier must still refuse because the secret is unconfigured.
    const header = `t=${t},v1=${signHex(t, body, '')}`;
    expect(() =>
      verifier.verify(ctxFor(header, body, { signingSecret: '' })),
    ).toThrow(SignatureInvalidError);
  });

  it('verifies a body containing non-UTF8 bytes (raw-byte integrity)', async () => {
    const t = Math.floor(Date.now() / 1000);
    const body = Buffer.from([0xff, 0x28, 0x80]);
    const header = `t=${t},v1=${signHex(t, body)}`;
    await expect(
      verifier.verify(ctxFor(header, body)),
    ).resolves.toBeUndefined();
  });

  it('rejects a non-UTF8 body whose bytes were altered after signing', () => {
    const t = Math.floor(Date.now() / 1000);
    const signedBody = Buffer.from([0xff, 0x28, 0x80]);
    const header = `t=${t},v1=${signHex(t, signedBody)}`;
    const tamperedBody = Buffer.from([0xff, 0x28, 0x81]);
    expect(() => verifier.verify(ctxFor(header, tamperedBody))).toThrow(
      SignatureInvalidError,
    );
  });
});
