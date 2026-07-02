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

/**
 * Normalizes FiveM panel webhooks. The shared-secret payload is a flat
 * `{ event, player?, server? }` envelope; the delivery id comes from `body.id`
 * or the `x-delivery-id` header when present. Only `player.join` and
 * `server.crash` are mapped; other events are recognized but ignored (`null`).
 */
@Injectable()
export class FivemNormalizer extends PayloadNormalizer {
  readonly provider = WebhookProvider.FiveM;
  private readonly logger = new Logger('webhooks.normalizer.fivem');

  normalize(ctx: NormalizationContext): Promise<IntegrationEvent | null> {
    return Promise.resolve(this.normalizeSync(ctx));
  }

  private normalizeSync(ctx: NormalizationContext): IntegrationEvent | null {
    const body = this.parse(ctx.rawBody);
    if (!body) return null;

    const event = str(body, 'event');
    if (!event) return null;

    const deliveryId = str(body, 'id') ?? ctx.headers['x-delivery-id'] ?? null;

    switch (event) {
      case 'player.join': {
        const player = obj(body, 'player');
        return this.build(ctx, deliveryId, 'fivem.player.join', {
          playerId: str(player, 'id') ?? null,
          name: str(player, 'name') ?? null,
        });
      }
      case 'server.crash': {
        const server = obj(body, 'server');
        return this.build(ctx, deliveryId, 'fivem.server.crash', {
          reason: str(server, 'reason') ?? null,
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
      this.logger.debug('fivem payload was not valid JSON; ignoring');
      return null;
    }
  }
}
