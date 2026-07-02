import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventBus, type Subscription } from '../../../../core/events/event-bus';
import type { EventName } from '../../../../core/events/registry/event-map';
import { WEBHOOKS_HANDLER_PREFIX } from '../../webhooks.constants';
import { WebhooksConfigService } from '../../config/webhooks-config.service';
import { OutboundDispatchService } from '../../application/outbound-dispatch.service';

/**
 * Outbound trigger: subscribes to the allowlisted platform domain events
 * (`config.outbound.allowedOutboundEvents`, including `integration.event` so
 * guilds can re-broadcast normalized inbound events outward) and hands each
 * matching envelope to the {@link OutboundDispatchService}, which resolves
 * subscriptions and enqueues delivery. Handlers are fire-and-forget with
 * respect to the bus — a dispatch failure is handled inside the service and
 * never propagates back onto the publish path. This module never imports the
 * emitting modules; it only knows the registered event names.
 */
@Injectable()
export class OutboundTriggerConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly subs: Subscription[] = [];

  constructor(
    private readonly bus: EventBus,
    private readonly config: WebhooksConfigService,
    private readonly dispatch: OutboundDispatchService,
  ) {}

  onModuleInit(): void {
    for (const name of this.config.global().outbound.allowedOutboundEvents) {
      const sub = this.bus.subscribe(
        name as EventName,
        (env) => {
          void this.dispatch.dispatchForEvent(env);
        },
        { handlerId: `${WEBHOOKS_HANDLER_PREFIX}:outbound:${name}` },
      );
      this.subs.push(sub);
    }
  }

  onModuleDestroy(): void {
    for (const sub of this.subs) sub.unsubscribe();
    this.subs.length = 0;
  }
}
