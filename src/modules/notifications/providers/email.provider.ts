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
 * Email transport. Disabled by default (`NOTIFICATIONS_EMAIL_ENABLED`); when
 * enabled it requires an SMTP URL. The concrete SMTP send is intentionally left
 * as a single seam ({@link deliver}) so wiring an SMTP client (nodemailer) later
 * is additive and needs no change to callers or the delivery worker. Until then
 * an enabled-but-unconfigured channel fails permanently with a clear reason
 * rather than silently dropping.
 */
@Injectable()
export class EmailProvider extends NotificationProvider {
  private readonly logger = new Logger('notifications.provider.email');
  readonly channel: NotificationChannel = 'EMAIL';

  constructor(private readonly config: NotificationsConfigService) {
    super();
  }

  async send(
    recipient: NotificationRecipient,
    message: RenderedMessage,
  ): Promise<ProviderSendResult> {
    const email = this.config.global().email;
    if (!email.enabled) {
      return { ok: false, retryable: false, error: 'email channel disabled' };
    }
    if (!email.smtpUrl) {
      return {
        ok: false,
        retryable: false,
        error:
          'email channel enabled but NOTIFICATIONS_EMAIL_SMTP_URL is unset',
      };
    }
    if (!recipient.email) {
      return {
        ok: false,
        retryable: false,
        error: 'EMAIL requires a recipient email',
      };
    }
    return this.deliver(
      recipient.email,
      message,
      email.fromAddress,
      email.smtpUrl,
    );
  }

  healthCheck(): Promise<{ healthy: boolean; detail?: string }> {
    const email = this.config.global().email;
    if (!email.enabled)
      return Promise.resolve({ healthy: true, detail: 'disabled' });
    return Promise.resolve({
      healthy: Boolean(email.smtpUrl),
      detail: email.smtpUrl ? 'configured' : 'smtpUrl unset',
    });
  }

  /**
   * SMTP send seam. Returns a retryable failure until an SMTP client is wired,
   * so an operator who flips the flag on before installing the transport gets a
   * visible DLQ entry instead of a false success.
   */
  protected deliver(
    to: string,
    _message: RenderedMessage,
    _from: string,
    _smtpUrl: string,
  ): Promise<ProviderSendResult> {
    this.logger.warn(
      `email transport not wired; would send to ${to} (install & bind an SMTP client)`,
    );
    return Promise.resolve({
      ok: false,
      retryable: true,
      error: 'email transport not wired',
    });
  }
}
