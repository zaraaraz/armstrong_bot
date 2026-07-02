import { Injectable, Logger } from '@nestjs/common';
import type { IntegrationEvent } from '../domain/integration-event';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import {
  PayloadNormalizer,
  type NormalizationContext,
} from './payload-normalizer.interface';

/** Reads a string field defensively from untrusted parsed JSON. */
function str(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

/** Reads a nested object defensively (returns an empty record on mismatch). */
function obj(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Reads a nested number field defensively. */
function num(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Normalizes GitHub webhook payloads into canonical {@link IntegrationEvent}s,
 * branching on the `x-github-event` header. Only `push`, `pull_request`, and
 * `workflow_run` are mapped; every other event (including `ping`) is recognized
 * but intentionally ignored (returns `null`) so GitHub keeps the hook enabled.
 * The `x-github-delivery` header is the provider delivery id / idempotency key.
 */
@Injectable()
export class GithubNormalizer extends PayloadNormalizer {
  readonly provider = WebhookProvider.GitHub;
  private readonly logger = new Logger('webhooks.normalizer.github');

  normalize(ctx: NormalizationContext): Promise<IntegrationEvent | null> {
    return Promise.resolve(this.normalizeSync(ctx));
  }

  private normalizeSync(ctx: NormalizationContext): IntegrationEvent | null {
    const event = ctx.headers['x-github-event'];
    if (!event || event === 'ping') return null;

    const body = this.parse(ctx.rawBody);
    if (!body) return null;

    const deliveryId = ctx.headers['x-github-delivery'] ?? null;
    const repo = str(obj(body, 'repository'), 'full_name') ?? null;

    switch (event) {
      case 'push':
        return this.build(ctx, deliveryId, 'github.push', {
          repo,
          ref: str(body, 'ref') ?? null,
          before: str(body, 'before') ?? null,
          after: str(body, 'after') ?? null,
          commitCount: Array.isArray(body['commits'])
            ? body['commits'].length
            : 0,
          pusher: str(obj(body, 'pusher'), 'name') ?? null,
        });
      case 'pull_request':
        return this.build(ctx, deliveryId, 'github.pull_request', {
          action: str(body, 'action') ?? null,
          number: num(body, 'number') ?? null,
          title: str(obj(body, 'pull_request'), 'title') ?? null,
          repo,
        });
      case 'workflow_run': {
        const run = obj(body, 'workflow_run');
        return this.build(ctx, deliveryId, 'github.workflow_run', {
          name: str(run, 'name') ?? null,
          status: str(run, 'status') ?? null,
          conclusion: str(run, 'conclusion') ?? null,
          repo,
        });
      }
      default:
        return null;
    }
  }

  private build(
    ctx: NormalizationContext,
    deliveryId: string | null,
    type: string,
    data: Readonly<Record<string, unknown>>,
  ): IntegrationEvent {
    return {
      type,
      provider: this.provider,
      guildId: ctx.guildId,
      deliveryId,
      internalDeliveryId: ctx.internalDeliveryId,
      occurredAt: new Date(),
      data,
    };
  }

  private parse(rawBody: Buffer): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      this.logger.debug('github payload was not valid JSON; ignoring');
      return null;
    }
  }
}
