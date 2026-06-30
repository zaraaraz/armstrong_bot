import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventBus } from '../../core/events/event-bus';
import {
  WebhookDeliveryRepository,
  type WebhookDeliveryRecord,
} from '../repositories/webhook-delivery.repository';
import type { WebhookProvider } from './signature.verifier';

export interface IngestInput {
  readonly provider: WebhookProvider;
  readonly eventType: string;
  readonly guildId: string | null;
  readonly signature: string | null;
  readonly payload: Record<string, unknown>;
  readonly requestId: string;
}

/**
 * Routes a verified inbound webhook onto the platform: persists a durable
 * {@link WebhookDeliveryRecord} (audit trail) and emits `api.webhook.received`
 * onto the Event Bus. The bus owns durable async delivery + dead-lettering, so
 * downstream module processing and retries flow through existing infrastructure
 * rather than a separate queue.
 */
@Injectable()
export class WebhookRouterService {
  private readonly logger = new Logger('api.webhook');

  constructor(
    private readonly deliveries: WebhookDeliveryRepository,
    @Inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  async ingest(input: IngestInput): Promise<WebhookDeliveryRecord> {
    const record = await this.deliveries.create({
      provider: input.provider,
      eventType: input.eventType,
      guildId: input.guildId,
      signature: input.signature,
      payload: input.payload,
      requestId: input.requestId,
    });

    try {
      await this.eventBus.publish(
        'api.webhook.received',
        {
          provider: input.provider,
          eventType: input.eventType,
          guildId: input.guildId,
          deliveryId: record.id,
          requestId: input.requestId,
          receivedAt: record.receivedAt.toISOString(),
        },
        {
          guildId: input.guildId,
          actor: { type: 'api', id: 'webhook' },
          idempotencyKey: record.id,
        },
      );
      await this.deliveries.markProcessed(record.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({
        msg: 'webhook.route.failed',
        deliveryId: record.id,
        error: message,
      });
      await this.deliveries.markFailed(record.id, message);
    }
    return record;
  }
}
