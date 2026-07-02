import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnsupportedProviderError } from '../domain/errors/unsupported-provider.error';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import { SignatureVerifier } from './signature-verifier.interface';

/**
 * DI token for the array of every registered {@link SignatureVerifier}. The
 * module file provides it via `useFactory`, listing the concrete verifier
 * classes; the registry consumes it and indexes them by provider.
 */
export const WEBHOOK_VERIFIERS = Symbol('WEBHOOK_VERIFIERS');

/**
 * DI-populated map keyed by {@link WebhookProvider}. Verifiers self-register by
 * being listed under the {@link WEBHOOK_VERIFIERS} token; the registry indexes
 * them by their declared `provider`. `resolve()` throws
 * {@link UnsupportedProviderError} for an unregistered provider so an inbound
 * request for an unknown provider fails closed rather than silently skipping
 * verification.
 */
@Injectable()
export class VerifierRegistry {
  private readonly logger = new Logger('webhooks.verification');
  private readonly byProvider = new Map<WebhookProvider, SignatureVerifier>();

  constructor(
    @Inject(WEBHOOK_VERIFIERS) verifiers: readonly SignatureVerifier[],
  ) {
    for (const verifier of verifiers) {
      if (this.byProvider.has(verifier.provider)) {
        this.logger.warn(
          `duplicate verifier for provider ${verifier.provider}; keeping the first`,
        );
        continue;
      }
      this.byProvider.set(verifier.provider, verifier);
    }
    this.logger.debug(
      `registered verifiers: ${[...this.byProvider.keys()].join(', ')}`,
    );
  }

  /** Returns the verifier for a provider, or throws if none is registered. */
  resolve(provider: WebhookProvider): SignatureVerifier {
    const verifier = this.byProvider.get(provider);
    if (!verifier) {
      throw new UnsupportedProviderError(provider);
    }
    return verifier;
  }

  providers(): readonly WebhookProvider[] {
    return [...this.byProvider.keys()];
  }
}
