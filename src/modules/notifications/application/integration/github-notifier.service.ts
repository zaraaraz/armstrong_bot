import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { EventBus } from '../../../../core/events/event-bus';
import { NotificationsConfigService } from '../../config/notifications-config.service';
import { IntegrationSubscriptionRepository } from '../../infrastructure/integration-subscription.repository';

/** Minimal shape of the GitHub `push` webhook payload we consume. */
export interface GithubPushBody {
  readonly ref?: string;
  readonly after?: string;
  readonly commits?: ReadonlyArray<unknown>;
  readonly repository?: { full_name?: string; html_url?: string };
  readonly pusher?: { name?: string };
}

export interface GithubIngestResult {
  readonly accepted: boolean;
  readonly reason?: string;
}

/**
 * GitHub push notifier — webhook-driven (not polled). {@link verifySignature}
 * validates the `X-Hub-Signature-256` HMAC against the configured secret using
 * a constant-time compare; {@link ingest} fans out `integration.github.push`
 * exactly once per commit sha (the sha is the idempotency key). Subscriptions
 * are matched by repository full name so only subscribed guilds are notified.
 */
@Injectable()
export class GithubNotifierService {
  private readonly logger = new Logger('notifications.integration.github');

  constructor(
    private readonly subs: IntegrationSubscriptionRepository,
    private readonly bus: EventBus,
    private readonly config: NotificationsConfigService,
  ) {}

  /**
   * Constant-time HMAC-SHA256 verification of the raw request body. Returns
   * false when no secret is configured (fail closed) or the signature mismatches.
   */
  verifySignature(
    rawBody: Buffer | string,
    signatureHeader: string | undefined,
  ): boolean {
    const secret = this.config.global().integrations.githubWebhookSecret;
    if (!secret) {
      this.logger.warn('github webhook secret not configured; rejecting');
      return false;
    }
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }
    const provided = signatureHeader.slice('sha256='.length);
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Ingests a verified push event: fans out `integration.github.push` to each
   * subscribed guild for the repository. `after` (the head sha) is the dedupe
   * key, so a redelivered webhook produces no duplicate notification.
   */
  async ingest(body: GithubPushBody): Promise<GithubIngestResult> {
    const repo = body.repository?.full_name;
    const sha = body.after;
    if (!repo || !sha) {
      return { accepted: false, reason: 'missing repository or sha' };
    }
    const subscriptions = await this.subs.listActiveByProvider('GITHUB');
    const matching = subscriptions.filter((s) => s.externalId === repo);
    if (matching.length === 0) {
      return { accepted: false, reason: 'no subscription for repository' };
    }

    for (const sub of matching) {
      await this.bus.publish(
        'integration.github.push',
        {
          guildId: sub.guildId,
          externalId: repo,
          ref: body.ref ?? 'unknown',
          commitSha: sha,
          commitCount: body.commits?.length ?? 0,
          pusher: body.pusher?.name ?? 'unknown',
          url: body.repository?.html_url ?? `https://github.com/${repo}`,
          occurredAt: new Date().toISOString(),
        },
        {
          guildId: sub.guildId,
          actor: { type: 'system', id: 'notifications.github' },
          idempotencyKey: `${sub.guildId}:${sha}`,
          meta: sub.announceChannelId
            ? { announceChannelId: sub.announceChannelId }
            : undefined,
        },
      );
      await this.subs.setCursor(sub.id, sha);
    }
    return { accepted: true };
  }
}
