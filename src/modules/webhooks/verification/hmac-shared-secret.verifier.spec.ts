import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import { CustomVerifier, FiveMVerifier } from './hmac-shared-secret.verifier';
import { SignatureInvalidError } from '../domain/errors/signature-invalid.error';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import type { VerificationContext } from './signature-verifier.interface';

const SECRET = 'shared-secret';
const BODY = Buffer.from('{"event":"player.join","id":42}');

/** Raw hex HMAC-SHA256 of `body` keyed by `secret`, no prefix. */
function hex(body: Buffer, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Build a VerificationContext with the given headers/body/secret. */
function ctx(
  headers: Record<string, string | undefined>,
  overrides: Partial<VerificationContext> = {},
): VerificationContext {
  return {
    rawBody: BODY,
    headers,
    signingSecret: SECRET,
    toleranceSeconds: 300,
    ...overrides,
  };
}

describe('HmacSharedSecretVerifier (via FiveMVerifier)', () => {
  it('resolves for a valid signature in x-signature-256 (raw hex, no prefix)', async () => {
    const verifier = new FiveMVerifier();
    await expect(
      verifier.verify(ctx({ 'x-signature-256': hex(BODY) })),
    ).resolves.toBeUndefined();
  });

  it('resolves for a valid signature in x-webhook-signature WITH sha256= prefix', async () => {
    const verifier = new FiveMVerifier();
    await expect(
      verifier.verify(ctx({ 'x-webhook-signature': `sha256=${hex(BODY)}` })),
    ).resolves.toBeUndefined();
  });

  it('throws SignatureInvalidError when the body is tampered', () => {
    const verifier = new FiveMVerifier();
    const sig = hex(BODY);
    const tampered = ctx(
      { 'x-signature-256': sig },
      { rawBody: Buffer.from('{"event":"player.join","id":43}') },
    );
    expect(() => verifier.verify(tampered)).toThrow(SignatureInvalidError);
  });

  it('throws when the signature was made with the wrong secret', () => {
    const verifier = new FiveMVerifier();
    const sig = hex(BODY, 'not-the-secret');
    expect(() => verifier.verify(ctx({ 'x-signature-256': sig }))).toThrow(
      SignatureInvalidError,
    );
  });

  it('throws when neither signature header is present', () => {
    const verifier = new FiveMVerifier();
    expect(() =>
      verifier.verify(ctx({ 'content-type': 'application/json' })),
    ).toThrow(SignatureInvalidError);
  });

  it('throws when the header is present but empty (falls through to missing)', () => {
    const verifier = new FiveMVerifier();
    expect(() => verifier.verify(ctx({ 'x-signature-256': '' }))).toThrow(
      SignatureInvalidError,
    );
  });

  it('throws when the header only carries the sha256= prefix (empty value)', () => {
    const verifier = new FiveMVerifier();
    expect(() =>
      verifier.verify(ctx({ 'x-webhook-signature': 'sha256=' })),
    ).toThrow(SignatureInvalidError);
  });

  it('throws (fail-closed) when signingSecret is empty', () => {
    const verifier = new FiveMVerifier();
    expect(() =>
      verifier.verify(
        ctx({ 'x-signature-256': hex(BODY) }, { signingSecret: '' }),
      ),
    ).toThrow(SignatureInvalidError);
  });

  it('throws on a length-mismatch (short hex) without crashing before timingSafeEqual', () => {
    const verifier = new FiveMVerifier();
    // Valid hex but far shorter than a 32-byte digest -> length guard rejects.
    expect(() => verifier.verify(ctx({ 'x-signature-256': 'abcd' }))).toThrow(
      SignatureInvalidError,
    );
  });

  it('prefers x-signature-256 over x-webhook-signature when both are present', async () => {
    const verifier = new FiveMVerifier();
    await expect(
      verifier.verify(
        ctx({
          'x-signature-256': hex(BODY),
          'x-webhook-signature': 'sha256=deadbeef',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('provider identities', () => {
  it('FiveMVerifier.provider === WebhookProvider.FiveM', () => {
    expect(new FiveMVerifier().provider).toBe(WebhookProvider.FiveM);
  });

  it('CustomVerifier.provider === WebhookProvider.Custom', () => {
    expect(new CustomVerifier().provider).toBe(WebhookProvider.Custom);
  });

  it('CustomVerifier verifies with the same shared-secret logic', async () => {
    const verifier = new CustomVerifier();
    await expect(
      verifier.verify(ctx({ 'x-signature-256': hex(BODY) })),
    ).resolves.toBeUndefined();
  });
});
