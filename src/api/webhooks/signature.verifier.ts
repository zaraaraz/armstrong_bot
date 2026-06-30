import { createHmac, timingSafeEqual, verify as cryptoVerify } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SecretService } from '../../shared/security/services/secret.service';

export type WebhookProvider = 'discord' | 'github' | 'stripe' | 'fivem';

export interface SignatureInput {
  readonly provider: WebhookProvider;
  readonly rawBody: Buffer;
  readonly headers: Record<string, string | string[] | undefined>;
}

/**
 * Per-provider inbound webhook signature verification. Each provider's signing
 * secret/public key is resolved from the Secret vault, never hard-coded:
 * - Discord: Ed25519 over `timestamp + body` using the app public key.
 * - GitHub:  HMAC-SHA256 over the raw body, `sha256=` prefixed.
 * - Stripe:  HMAC-SHA256 over `timestamp.body` from the `Stripe-Signature` header.
 * - FiveM:   HMAC-SHA256 over the raw body (shared secret).
 */
@Injectable()
export class SignatureVerifier {
  constructor(@Inject(SecretService) private readonly secrets: SecretService) {}

  async verify(input: SignatureInput): Promise<boolean> {
    switch (input.provider) {
      case 'discord':
        return this.verifyDiscord(input);
      case 'github':
        return this.verifyGithub(input);
      case 'stripe':
        return this.verifyStripe(input);
      case 'fivem':
        return this.verifyFivem(input);
      default:
        return false;
    }
  }

  private async verifyDiscord(input: SignatureInput): Promise<boolean> {
    const signature = this.header(input, 'x-signature-ed25519');
    const timestamp = this.header(input, 'x-signature-timestamp');
    const publicKey = await this.secrets.get('DISCORD_PUBLIC_KEY');
    if (!signature || !timestamp || !publicKey) return false;

    const message = Buffer.concat([
      Buffer.from(timestamp, 'utf8'),
      input.rawBody,
    ]);
    const keyDer = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'), // Ed25519 SPKI prefix
      Buffer.from(publicKey, 'hex'),
    ]);
    try {
      return cryptoVerify(
        null,
        message,
        {
          key: keyDer,
          format: 'der',
          type: 'spki',
        },
        Buffer.from(signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  private async verifyGithub(input: SignatureInput): Promise<boolean> {
    const provided = this.header(input, 'x-hub-signature-256');
    const secret = await this.secrets.get('GITHUB_WEBHOOK_SECRET');
    if (!provided || !secret) return false;
    const expected =
      'sha256=' +
      createHmac('sha256', secret).update(input.rawBody).digest('hex');
    return this.safeEqual(provided, expected);
  }

  private async verifyStripe(input: SignatureInput): Promise<boolean> {
    const header = this.header(input, 'stripe-signature');
    const secret = await this.secrets.get('STRIPE_WEBHOOK_SECRET');
    if (!header || !secret) return false;
    const parts = Object.fromEntries(
      header.split(',').map((kv) => {
        const [k, v] = kv.split('=');
        return [k.trim(), v];
      }),
    );
    const timestamp = parts['t'];
    const provided = parts['v1'];
    if (!timestamp || !provided) return false;
    const signedPayload = `${timestamp}.${input.rawBody.toString('utf8')}`;
    const expected = createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');
    return this.safeEqual(provided, expected);
  }

  private async verifyFivem(input: SignatureInput): Promise<boolean> {
    const provided = this.header(input, 'x-fivem-signature');
    const secret = await this.secrets.get('FIVEM_WEBHOOK_SECRET');
    if (!provided || !secret) return false;
    const expected = createHmac('sha256', secret)
      .update(input.rawBody)
      .digest('hex');
    return this.safeEqual(provided, expected);
  }

  private header(input: SignatureInput, name: string): string | null {
    const value = input.headers[name];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.length > 0) return value[0];
    return null;
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
