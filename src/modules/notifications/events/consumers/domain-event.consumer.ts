import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventBus, type Subscription } from '../../../../core/events/event-bus';
import type { EventEnvelope } from '../../../../core/events/envelope/event-envelope';
import type { EventName } from '../../../../core/events/registry/event-map';
import { NOTIFICATIONS_HANDLER_PREFIX } from '../../notifications.constants';
import { INotificationService } from '../../notifications.public';
import { NotificationRoutingService } from '../../application/notification-routing.service';

/**
 * Inbound surface: subscribes to the routed domain events (moderation, tickets,
 * integrations) and turns each into a `NotificationService.dispatch`. Handlers
 * are fire-and-forget with respect to the bus — a dispatch failure is logged by
 * the service and never propagates back onto the publish path. This module
 * never imports the emitting modules; it only knows the registered event names.
 */
@Injectable()
export class DomainEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly subs: Subscription[] = [];

  constructor(
    private readonly bus: EventBus,
    private readonly routing: NotificationRoutingService,
    private readonly notifications: INotificationService,
  ) {}

  onModuleInit(): void {
    for (const name of this.routing.routedEventNames()) {
      const sub = this.bus.subscribe(
        name as EventName,
        (env) => {
          void this.handle(env);
        },
        { handlerId: `${NOTIFICATIONS_HANDLER_PREFIX}:${name}` },
      );
      this.subs.push(sub);
    }
  }

  onModuleDestroy(): void {
    for (const sub of this.subs) sub.unsubscribe();
    this.subs.length = 0;
  }

  private async handle(envelope: EventEnvelope): Promise<void> {
    const input = await this.routing.route(envelope);
    if (!input) return;
    // dispatch is internally guarded; propagate nothing onto the bus.
    await this.notifications
      .dispatch({ ...input, dedupeKey: input.dedupeKey ?? envelope.id })
      .catch(() => undefined);
  }
}
