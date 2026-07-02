import type { WebhookProvider } from '../domain/webhook-provider.enum';
import type { IntegrationEvent } from '../domain/integration-event';

/** Context handed to a normalizer for one verified inbound delivery. */
export interface NormalizationContext {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly guildId: string | null;
  readonly internalDeliveryId: string;
}

/**
 * Strategy contract turning a verified provider payload into the canonical
 * {@link IntegrationEvent}. Returns `null` when the event is recognized but
 * intentionally ignored (so the delivery is marked processed, not failed).
 */
export abstract class PayloadNormalizer {
  abstract readonly provider: WebhookProvider;
  abstract normalize(
    ctx: NormalizationContext,
  ): Promise<IntegrationEvent | null>;
}
