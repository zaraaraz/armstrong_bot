import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../core/events/event-bus';
import type { GhostEventMap } from '../../../core/events/registry/event-map';
import type { IntegrationEvent } from '../domain/integration-event';
import { WebhookEvents, type WebhookEventName } from './webhook.events';

/**
 * Publishes the Webhooks module's own events on the core bus. The
 * `integration.event` envelope is the primary output of the inbound pipeline;
 * `webhooks.delivery.failed` and `webhooks.outbound.dead_lettered` are
 * lifecycle signals consumed by the dashboard and metrics. Every publish is
 * attributed to the `system:webhooks` actor.
 */
@Injectable()
export class WebhookEventEmitter {
  constructor(private readonly eventBus: EventBus) {}

  /**
   * Publishes a normalized inbound event. The domain `IntegrationEvent` carries
   * `occurredAt` as a `Date`; the wire payload needs an ISO string, so we
   * convert at the boundary. `provider` is already a lowercase string value.
   */
  async emitIntegrationEvent(evt: IntegrationEvent): Promise<void> {
    const payload: GhostEventMap[typeof WebhookEvents.IntegrationEvent] = {
      type: evt.type,
      provider: evt.provider,
      guildId: evt.guildId,
      deliveryId: evt.deliveryId,
      internalDeliveryId: evt.internalDeliveryId,
      occurredAt: evt.occurredAt.toISOString(),
      data: { ...evt.data },
    };
    await this.publish(WebhookEvents.IntegrationEvent, payload, evt.guildId);
  }

  async emitDeliveryFailed(
    payload: GhostEventMap[typeof WebhookEvents.DeliveryFailed],
  ): Promise<void> {
    await this.publish(WebhookEvents.DeliveryFailed, payload, payload.guildId);
  }

  async emitOutboundDeadLettered(
    payload: GhostEventMap[typeof WebhookEvents.OutboundDeadLettered],
  ): Promise<void> {
    await this.publish(
      WebhookEvents.OutboundDeadLettered,
      payload,
      payload.guildId,
    );
  }

  private async publish<K extends WebhookEventName>(
    name: K,
    payload: GhostEventMap[K],
    guildId: string | null,
  ): Promise<void> {
    await this.eventBus.publish(name, payload, {
      guildId,
      actor: { type: 'system', id: 'webhooks' },
    });
  }
}
