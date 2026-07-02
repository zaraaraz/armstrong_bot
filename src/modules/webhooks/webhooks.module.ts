import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// Config + domain
import { WebhooksConfigService } from './config/webhooks-config.service';
import { IdempotencyGuard } from './domain/idempotency.guard';
// Repositories
import { WebhookEndpointRepository } from './repositories/webhook-endpoint.repository';
import { WebhookSubscriptionRepository } from './repositories/webhook-subscription.repository';
import { WebhookDeliveryRepository } from './repositories/webhook-delivery.repository';
// Verification strategies + registry
import { SignatureVerifier } from './verification/signature-verifier.interface';
import {
  VerifierRegistry,
  WEBHOOK_VERIFIERS,
} from './verification/verifier.registry';
import { GithubVerifier } from './verification/github.verifier';
import { StripeVerifier } from './verification/stripe.verifier';
import {
  CustomVerifier,
  FiveMVerifier,
} from './verification/hmac-shared-secret.verifier';
// Normalization strategies + registry
import { PayloadNormalizer } from './normalization/payload-normalizer.interface';
import {
  NormalizerRegistry,
  WEBHOOK_NORMALIZERS,
} from './normalization/normalizer.registry';
import { GithubNormalizer } from './normalization/github.normalizer';
import { StripeNormalizer } from './normalization/stripe.normalizer';
import { FivemNormalizer } from './normalization/fivem.normalizer';
import { CustomNormalizer } from './normalization/custom.normalizer';
// Application services
import { InboundWebhookService } from './application/inbound-webhook.service';
import { OutboundDispatchService } from './application/outbound-dispatch.service';
import { WebhookEndpointService } from './application/webhook-endpoint.service';
import { WebhookSubscriptionService } from './application/webhook-subscription.service';
// Jobs
import { WebhooksQueues } from './jobs/webhooks.queue';
import { InboundProcessor } from './jobs/inbound-processor.worker';
import { OutboundDeliveryWorker } from './jobs/outbound-delivery.worker';
// Events
import { WebhookEventEmitter } from './events/webhook-event.emitter';
import { OutboundTriggerConsumer } from './events/consumers/outbound-trigger.consumer';
// API
import { WebhookController } from './api/webhook.controller';
import { WebhookAdminController } from './api/webhook-admin.controller';

/**
 * Webhooks module (Phase 4, item 18). The platform's secure ingress/egress
 * gateway for third-party integrations: it is the ONLY place that terminates raw
 * external HTTP integration traffic, verifies signatures (constant-time),
 * dedupes, normalizes onto the Event Bus as `IntegrationEvent`, and delivers the
 * platform's own domain events outward with HMAC signing + retry/backoff + DLQ.
 * `@Global` so in-process callers can inject its services without re-importing;
 * cross-module consumers listen for `integration.event` on the bus instead.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [WebhookController, WebhookAdminController],
  providers: [
    // Config + domain
    WebhooksConfigService,
    IdempotencyGuard,
    // Repositories
    WebhookEndpointRepository,
    WebhookSubscriptionRepository,
    WebhookDeliveryRepository,
    // Verification strategies (collected under the WEBHOOK_VERIFIERS token)
    GithubVerifier,
    StripeVerifier,
    FiveMVerifier,
    CustomVerifier,
    {
      provide: WEBHOOK_VERIFIERS,
      useFactory: (
        github: GithubVerifier,
        stripe: StripeVerifier,
        fivem: FiveMVerifier,
        custom: CustomVerifier,
      ): readonly SignatureVerifier[] => [github, stripe, fivem, custom],
      inject: [GithubVerifier, StripeVerifier, FiveMVerifier, CustomVerifier],
    },
    VerifierRegistry,
    // Normalization strategies (collected under the WEBHOOK_NORMALIZERS token)
    GithubNormalizer,
    StripeNormalizer,
    FivemNormalizer,
    CustomNormalizer,
    {
      provide: WEBHOOK_NORMALIZERS,
      useFactory: (
        github: GithubNormalizer,
        stripe: StripeNormalizer,
        fivem: FivemNormalizer,
        custom: CustomNormalizer,
      ): readonly PayloadNormalizer[] => [github, stripe, fivem, custom],
      inject: [
        GithubNormalizer,
        StripeNormalizer,
        FivemNormalizer,
        CustomNormalizer,
      ],
    },
    NormalizerRegistry,
    // Application services
    InboundWebhookService,
    OutboundDispatchService,
    WebhookEndpointService,
    WebhookSubscriptionService,
    // Jobs
    WebhooksQueues,
    InboundProcessor,
    OutboundDeliveryWorker,
    // Events
    WebhookEventEmitter,
    OutboundTriggerConsumer,
  ],
  exports: [
    InboundWebhookService,
    OutboundDispatchService,
    WebhookEndpointService,
    WebhookSubscriptionService,
  ],
})
export class WebhooksModule {}
