import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '../notifications.public';
import { NotificationProvider } from '../notifications.public';
import {
  NOTIFICATION_PROVIDERS,
  type NotificationProviderList,
} from './provider.contract';

/**
 * DI-populated map keyed by {@link NotificationChannel}. Providers self-register
 * by being listed under the {@link NOTIFICATION_PROVIDERS} token; the registry
 * indexes them by their declared `channel`. `resolve()` returns null for an
 * unregistered channel so the worker can dead-letter cleanly rather than throw.
 */
@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger('notifications.providers');
  private readonly byChannel = new Map<
    NotificationChannel,
    NotificationProvider
  >();

  constructor(
    @Inject(NOTIFICATION_PROVIDERS) providers: NotificationProviderList,
  ) {
    for (const provider of providers) {
      if (this.byChannel.has(provider.channel)) {
        this.logger.warn(
          `duplicate provider for channel ${provider.channel}; keeping the first`,
        );
        continue;
      }
      this.byChannel.set(provider.channel, provider);
    }
    this.logger.debug(
      `registered providers: ${[...this.byChannel.keys()].join(', ')}`,
    );
  }

  resolve(channel: NotificationChannel): NotificationProvider | null {
    return this.byChannel.get(channel) ?? null;
  }

  channels(): readonly NotificationChannel[] {
    return [...this.byChannel.keys()];
  }

  all(): readonly NotificationProvider[] {
    return [...this.byChannel.values()];
  }
}
