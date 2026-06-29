import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { EventBus, type Subscription } from '../event-bus';
import type { EventEnvelope } from '../envelope/event-envelope';
import {
  ON_EVENT_METADATA,
  type OnEventMetadata,
} from './event-handler.decorator';

/**
 * Bootstrap-time scanner that discovers methods decorated with {@link OnEvent}
 * across every NestJS provider/controller and registers them with the
 * {@link EventBus}. This is what makes the declarative subscription path live:
 * feature modules annotate a method and the scanner wires it up — they never
 * call `EventBus.subscribe()` by hand.
 */
@Injectable()
export class OnEventScanner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OnEventScanner.name);
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly eventBus: EventBus,
  ) {}

  onApplicationBootstrap(): void {
    const wrappers = [
      ...this.discovery.getProviders(),
      ...this.discovery.getControllers(),
    ];

    let registered = 0;
    for (const wrapper of wrappers) {
      registered += this.scanInstance(wrapper);
    }

    this.logger.log(
      `Registered ${registered} @OnEvent handler(s) across ${wrappers.length} provider(s).`,
    );
  }

  onApplicationShutdown(): void {
    for (const sub of this.subscriptions) sub.unsubscribe();
    this.subscriptions.length = 0;
  }

  private scanInstance(wrapper: InstanceWrapper): number {
    const instance: unknown = wrapper.instance;
    if (!instance || typeof instance !== 'object') return 0;

    const prototype = Object.getPrototypeOf(instance) as object | null;
    if (!prototype) return 0;

    let count = 0;
    for (const methodName of this.metadataScanner.getAllMethodNames(
      prototype,
    )) {
      const meta = this.readMetadata(prototype, methodName);
      if (!meta) continue;
      this.register(instance, methodName, meta);
      count += 1;
    }
    return count;
  }

  private readMetadata(
    prototype: object,
    methodName: string,
  ): OnEventMetadata | undefined {
    // `Reflect.metadata` applied as a method decorator stores the value on the
    // prototype, keyed by the property (method) name — not on the function.
    return Reflect.getMetadata(ON_EVENT_METADATA, prototype, methodName) as
      OnEventMetadata | undefined;
  }

  private register(
    instance: object,
    methodName: string,
    meta: OnEventMetadata,
  ): void {
    const className = instance.constructor?.name ?? 'Unknown';
    const handlerId = meta.options?.handlerId ?? `${className}:${methodName}`;
    const method = (
      instance as Record<
        string,
        (envelope: EventEnvelope) => void | Promise<void>
      >
    )[methodName].bind(instance);

    const subscription = this.eventBus.subscribe(
      meta.name,
      (envelope: EventEnvelope) => method(envelope),
      {
        handlerId,
        guildId: meta.options?.guildId,
        durable: meta.options?.durable,
      },
    );

    this.subscriptions.push(subscription);
    this.logger.debug(
      `Bound ${handlerId} -> ${meta.name} (durable=${meta.options?.durable ?? false}).`,
    );
  }
}
