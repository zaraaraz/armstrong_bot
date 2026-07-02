import type { WebhookProvider } from '../domain/webhook-provider.enum';

/** Everything a verifier needs to authenticate one inbound delivery. */
export interface VerificationContext {
  /** The exact bytes received — never a re-serialized JSON object. */
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** Decrypted signing secret / HMAC key for the resolved endpoint. */
  readonly signingSecret: string;
  /** Allowed clock skew for timestamped providers (Stripe). */
  readonly toleranceSeconds: number;
}

/**
 * Strategy contract for per-provider signature verification. Implementations
 * MUST use constant-time comparison and MUST throw
 * {@link SignatureInvalidError} on any failure (never return a boolean).
 */
export abstract class SignatureVerifier {
  abstract readonly provider: WebhookProvider;
  abstract verify(ctx: VerificationContext): Promise<void>;
}
