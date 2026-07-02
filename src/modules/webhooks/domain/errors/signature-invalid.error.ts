/**
 * Thrown when an inbound webhook signature fails verification (bad HMAC,
 * tampered body, expired/replayed timestamp, missing header). The message is
 * safe to log; it never contains the secret or the raw body.
 */
export class SignatureInvalidError extends Error {
  constructor(reason: string) {
    super(`webhook signature verification failed: ${reason}`);
    this.name = 'SignatureInvalidError';
  }
}
