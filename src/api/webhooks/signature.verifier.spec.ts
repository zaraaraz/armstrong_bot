import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'crypto';
import { SignatureVerifier } from './signature.verifier';
import type { SecretService } from '../../shared/security/services/secret.service';

function makeVerifier(secrets: Record<string, string>): SignatureVerifier {
  const secretService = {
    get: (name: string) => Promise.resolve(secrets[name]),
    require: (name: string) => Promise.resolve(secrets[name]),
  } as unknown as SecretService;
  return new SignatureVerifier(secretService);
}

describe('SignatureVerifier', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));

  describe('github', () => {
    it('accepts a valid HMAC-SHA256 signature', async () => {
      const secret = 'gh-secret';
      const sig =
        'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
      const v = makeVerifier({ GITHUB_WEBHOOK_SECRET: secret });
      const ok = await v.verify({
        provider: 'github',
        rawBody: body,
        headers: { 'x-hub-signature-256': sig },
      });
      expect(ok).toBe(true);
    });

    it('rejects an invalid signature', async () => {
      const v = makeVerifier({ GITHUB_WEBHOOK_SECRET: 'gh-secret' });
      const ok = await v.verify({
        provider: 'github',
        rawBody: body,
        headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
      });
      expect(ok).toBe(false);
    });

    it('rejects when no secret is configured', async () => {
      const v = makeVerifier({});
      const ok = await v.verify({
        provider: 'github',
        rawBody: body,
        headers: { 'x-hub-signature-256': 'sha256=abc' },
      });
      expect(ok).toBe(false);
    });
  });

  describe('stripe', () => {
    it('accepts a valid v1 signature', async () => {
      const secret = 'whsec_test';
      const t = '1700000000';
      const signed = `${t}.${body.toString('utf8')}`;
      const v1 = createHmac('sha256', secret).update(signed).digest('hex');
      const v = makeVerifier({ STRIPE_WEBHOOK_SECRET: secret });
      const ok = await v.verify({
        provider: 'stripe',
        rawBody: body,
        headers: { 'stripe-signature': `t=${t},v1=${v1}` },
      });
      expect(ok).toBe(true);
    });
  });

  describe('fivem', () => {
    it('accepts a valid HMAC signature', async () => {
      const secret = 'fivem-secret';
      const sig = createHmac('sha256', secret).update(body).digest('hex');
      const v = makeVerifier({ FIVEM_WEBHOOK_SECRET: secret });
      const ok = await v.verify({
        provider: 'fivem',
        rawBody: body,
        headers: { 'x-fivem-signature': sig },
      });
      expect(ok).toBe(true);
    });
  });

  describe('discord', () => {
    it('accepts a valid Ed25519 signature', async () => {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const rawPublic = publicKey
        .export({ format: 'der', type: 'spki' })
        .subarray(-32)
        .toString('hex');
      const timestamp = '1700000000';
      const message = Buffer.concat([Buffer.from(timestamp), body]);
      const signature = cryptoSign(null, message, privateKey).toString('hex');

      const v = makeVerifier({ DISCORD_PUBLIC_KEY: rawPublic });
      const ok = await v.verify({
        provider: 'discord',
        rawBody: body,
        headers: {
          'x-signature-ed25519': signature,
          'x-signature-timestamp': timestamp,
        },
      });
      expect(ok).toBe(true);
    });

    it('rejects a tampered body', async () => {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const rawPublic = publicKey
        .export({ format: 'der', type: 'spki' })
        .subarray(-32)
        .toString('hex');
      const timestamp = '1700000000';
      const signature = cryptoSign(
        null,
        Buffer.concat([Buffer.from(timestamp), body]),
        privateKey,
      ).toString('hex');

      const v = makeVerifier({ DISCORD_PUBLIC_KEY: rawPublic });
      const ok = await v.verify({
        provider: 'discord',
        rawBody: Buffer.from('tampered'),
        headers: {
          'x-signature-ed25519': signature,
          'x-signature-timestamp': timestamp,
        },
      });
      expect(ok).toBe(false);
    });
  });

  it('rejects an unknown provider', async () => {
    const v = makeVerifier({});
    const ok = await v.verify({
      provider: 'unknown' as never,
      rawBody: body,
      headers: {},
    });
    expect(ok).toBe(false);
  });
});
