import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnsupportedProviderError } from '../domain/errors/unsupported-provider.error';
import type { WebhookProvider } from '../domain/webhook-provider.enum';
import { PayloadNormalizer } from './payload-normalizer.interface';

/**
 * DI token for the array of every registered {@link PayloadNormalizer}. Mirrors
 * the verifier registry's multi-provider collection pattern; the module binds
 * the concrete normalizers under this token.
 */
export const WEBHOOK_NORMALIZERS = Symbol('WEBHOOK_NORMALIZERS');

/**
 * Indexes the DI-collected {@link PayloadNormalizer}s by their declared
 * `provider` so the inbound processor can resolve the right strategy in O(1).
 * {@link resolve} throws {@link UnsupportedProviderError} for a provider with no
 * registered normalizer (closed-for-modification: adding a provider is additive).
 */
@Injectable()
export class NormalizerRegistry {
  private readonly logger = new Logger('webhooks.normalizers');
  private readonly byProvider = new Map<WebhookProvider, PayloadNormalizer>();

  constructor(
    @Inject(WEBHOOK_NORMALIZERS) normalizers: readonly PayloadNormalizer[],
  ) {
    for (const normalizer of normalizers) {
      if (this.byProvider.has(normalizer.provider)) {
        this.logger.warn(
          `duplicate normalizer for provider ${normalizer.provider}; keeping the first`,
        );
        continue;
      }
      this.byProvider.set(normalizer.provider, normalizer);
    }
    this.logger.debug(
      `registered normalizers: ${[...this.byProvider.keys()].join(', ')}`,
    );
  }

  resolve(provider: WebhookProvider): PayloadNormalizer {
    const normalizer = this.byProvider.get(provider);
    if (!normalizer) {
      throw new UnsupportedProviderError(provider);
    }
    return normalizer;
  }

  providers(): readonly WebhookProvider[] {
    return [...this.byProvider.keys()];
  }
}
