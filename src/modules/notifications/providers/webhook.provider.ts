import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationProvider,
  type NotificationChannel,
  type NotificationRecipient,
  type ProviderSendResult,
  type RenderedMessage,
} from '../notifications.public';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Delivers a JSON payload to an arbitrary HTTPS endpoint (Discord webhook,
 * Slack incoming webhook, custom sink). The target URL comes from the
 * recipient's `webhookUrl`. 4xx (except 429) is permanent; 429 and 5xx are
 * retryable; network/timeout errors are retryable.
 */
@Injectable()
export class WebhookProvider extends NotificationProvider {
  private readonly logger = new Logger('notifications.provider.webhook');
  readonly channel: NotificationChannel = 'WEBHOOK';

  async send(
    recipient: NotificationRecipient,
    message: RenderedMessage,
  ): Promise<ProviderSendResult> {
    const url = recipient.webhookUrl;
    if (!url) {
      return {
        ok: false,
        retryable: false,
        error: 'WEBHOOK requires a webhookUrl',
      };
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: message.body,
          subject: message.subject,
          category: message.category,
          priority: message.priority,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        return {
          ok: true,
          retryable: false,
          providerMessageId: response.headers.get('x-message-id') ?? undefined,
        };
      }
      const retryable = response.status === 429 || response.status >= 500;
      return {
        ok: false,
        retryable,
        error: `webhook responded ${response.status}`,
      };
    } catch (err) {
      const message_ = err instanceof Error ? err.message : String(err);
      // Timeouts and connection failures are worth retrying.
      return { ok: false, retryable: true, error: message_ };
    }
  }

  healthCheck(): Promise<{ healthy: boolean; detail?: string }> {
    // Stateless transport — always healthy; per-endpoint failures surface as
    // delivery errors, not provider health.
    return Promise.resolve({ healthy: true });
  }
}
