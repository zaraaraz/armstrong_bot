import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import { GithubVerifier } from './github.verifier';
import type { VerificationContext } from './signature-verifier.interface';
import { SignatureInvalidError } from '../domain/errors/signature-invalid.error';
import { WebhookProvider } from '../domain/webhook-provider.enum';

const SECRET = 'shh';

/** HMAC-SHA256 header GitHub would send for `body` keyed by `secret`. */
function sign(body: Buffer, secret = SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

/** Build a VerificationContext, letting individual fields be overridden. */
function ctx(over: Partial<VerificationContext> = {}): VerificationContext {
  const rawBody =
    over.rawBody ?? Buffer.from(JSON.stringify({ hello: 'world' }));
  return {
    rawBody,
    headers: over.headers ?? { 'x-hub-signature-256': sign(rawBody) },
    signingSecret: over.signingSecret ?? SECRET,
    toleranceSeconds: over.toleranceSeconds ?? 300,
  };
}

describe('GithubVerifier', () => {
  let verifier: GithubVerifier;

  beforeEach(() => {
    verifier = new GithubVerifier();
  });

  it('exposes provider === WebhookProvider.GitHub', () => {
    expect(verifier.provider).toBe(WebhookProvider.GitHub);
  });

  it('resolves for a valid signature over the exact raw body', async () => {
    await expect(verifier.verify(ctx())).resolves.toBeUndefined();
  });

  it('throws SignatureInvalidError for a tampered body', () => {
    const signed = Buffer.from(JSON.stringify({ hello: 'world' }));
    const tampered = Buffer.from(JSON.stringify({ hello: 'w0rld' }));
    const context = ctx({
      rawBody: tampered,
      headers: { 'x-hub-signature-256': sign(signed) },
    });
    expect(() => verifier.verify(context)).toThrow(SignatureInvalidError);
  });

  it('throws SignatureInvalidError when signed with the wrong secret', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const context = ctx({
      rawBody: body,
      headers: { 'x-hub-signature-256': sign(body, 'not-the-secret') },
    });
    expect(() => verifier.verify(context)).toThrow(SignatureInvalidError);
  });

  it('throws SignatureInvalidError when the signature header is missing', () => {
    expect(() => verifier.verify(ctx({ headers: {} }))).toThrow(
      SignatureInvalidError,
    );
  });

  it('throws when the header is undefined explicitly', () => {
    const context = ctx({ headers: { 'x-hub-signature-256': undefined } });
    expect(() => verifier.verify(context)).toThrow(SignatureInvalidError);
  });

  it('throws for a malformed header without the sha256= prefix', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const raw = createHmac('sha256', SECRET).update(body).digest('hex');
    const context = ctx({
      rawBody: body,
      headers: { 'x-hub-signature-256': raw }, // no 'sha256=' prefix
    });
    expect(() => verifier.verify(context)).toThrow(SignatureInvalidError);
  });

  it('throws for a header with the prefix but a wrong algo label', () => {
    const context = ctx({ headers: { 'x-hub-signature-256': 'md5=deadbeef' } });
    expect(() => verifier.verify(context)).toThrow(SignatureInvalidError);
  });

  it('throws for a non-hex signature payload', () => {
    const context = ctx({
      headers: { 'x-hub-signature-256': 'sha256=not-hex-zzzz' },
    });
    expect(() => verifier.verify(context)).toThrow(SignatureInvalidError);
  });

  it('throws for a valid-hex signature of the wrong length', () => {
    const context = ctx({ headers: { 'x-hub-signature-256': 'sha256=abcd' } });
    expect(() => verifier.verify(context)).toThrow(SignatureInvalidError);
  });

  it('fails closed when the signing secret is empty (guard)', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    // Even a signature valid for an empty-key HMAC must be rejected.
    const context = ctx({
      rawBody: body,
      signingSecret: '',
      headers: { 'x-hub-signature-256': sign(body, '') },
    });
    expect(() => verifier.verify(context)).toThrow(SignatureInvalidError);
  });
});
