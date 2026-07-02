import { Injectable, Logger } from '@nestjs/common';
import { NotificationsConfigService } from '../config/notifications-config.service';
import {
  NotificationProvider,
  type NotificationChannel,
  type NotificationRecipient,
  type ProviderSendResult,
  type RenderedMessage,
} from '../notifications.public';

/**
 * Web-push transport. Disabled by default (`NOTIFICATIONS_PUSH_ENABLED`); when
 * enabled it requires a VAPID key pair. Like {@link EmailProvider}, the actual
 * push send is a single seam ({@link deliver}) so binding a web-push client
 * later is additive. `recipient.pushEndpoint` carries the subscription JSON.
 */
@Injectable()
export class PushProvider extends NotificationProvider {
  private readonly logger = new Logger('notifications.provider.push');
  readonly channel: NotificationChannel = 'PUSH';

  constructor(private readonly config: NotificationsConfigService) {
    super();
  }

  async send(
    recipient: NotificationRecipient,
    message: RenderedMessage,
  ): Promise<ProviderSendResult> {
    const push = this.config.global().push;
    if (!push.enabled) {
      return { ok: false, retryable: false, error: 'push channel disabled' };
    }
    if (!push.vapidPublicKey || !push.vapidPrivateKey) {
      return {
        ok: false,
        retryable: false,
        error: 'push channel enabled but VAPID keys are unset',
      };
    }
    if (!recipient.pushEndpoint) {
      return {
        ok: false,
        retryable: false,
        error: 'PUSH requires a pushEndpoint',
      };
    }
    return this.deliver(recipient.pushEndpoint, message);
  }

  healthCheck(): Promise<{ healthy: boolean; detail?: string }> {
    const push = this.config.global().push;
    if (!push.enabled)
      return Promise.resolve({ healthy: true, detail: 'disabled' });
    const configured = Boolean(push.vapidPublicKey && push.vapidPrivateKey);
    return Promise.resolve({
      healthy: configured,
      detail: configured ? 'configured' : 'VAPID keys unset',
    });
  }

  protected deliver(
    endpoint: string,
    _message: RenderedMessage,
  ): Promise<ProviderSendResult> {
    this.logger.warn(
      `push transport not wired; would notify ${endpoint.slice(0, 32)}… (bind a web-push client)`,
    );
    return Promise.resolve({
      ok: false,
      retryable: true,
      error: 'push transport not wired',
    });
  }
}
