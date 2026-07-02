// Module class
export { WebhooksModule } from './webhooks.module';

// Canonical envelope + wire types (the surface other modules consume — though
// cross-module consumers normally receive `IntegrationEvent` via the Event Bus,
// not by importing our services).
export type { IntegrationEvent, PageResult } from './domain/integration-event';
export { WebhookProvider } from './domain/webhook-provider.enum';
export { DeliveryStatus } from './domain/delivery-status.enum';

// Strategy contracts (for anyone extending providers additively).
export {
  SignatureVerifier,
  type VerificationContext,
} from './verification/signature-verifier.interface';
export {
  PayloadNormalizer,
  type NormalizationContext,
} from './normalization/payload-normalizer.interface';

// Event names & payload types (payload shapes live in the core event registry).
export { WebhookEvents, type WebhookEventName } from './events/webhook.events';

// Claims (for guards in other surfaces, e.g. the dashboard BFF).
export { WebhookClaims } from './webhooks.constants';
