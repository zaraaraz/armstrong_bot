import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { EventBus } from '../../core/events/event-bus';
import { API_CONFIG, type ApiConfig } from '../config/api.config';
import { ApiException } from '../common/errors/api-exception';
import { getApiContext } from '../common/context/request-id';
import { Public } from '../auth/decorators/public.decorator';
import { SignatureVerifier, type WebhookProvider } from './signature.verifier';
import { WebhookRouterService } from './webhook-router.service';
import { ApiPublic } from '../common/decorators/api-protected.decorator';

const PROVIDERS: ReadonlySet<string> = new Set([
  'discord',
  'github',
  'stripe',
  'fivem',
]);

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

@ApiTags('webhooks')
@ApiPublic()
@Controller('api/v1/webhooks')
export class WebhooksController {
  constructor(
    private readonly verifier: SignatureVerifier,
    private readonly router: WebhookRouterService,
    @Inject(EventBus) private readonly eventBus: EventBus,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post(':provider')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Verified inbound webhook ingress → Event Bus' })
  async ingest(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest,
  ): Promise<{ accepted: true; deliveryId: string }> {
    if (!PROVIDERS.has(provider)) {
      throw ApiException.notFound('Unknown webhook provider.');
    }
    if (!this.config.webhooks.enabledProviders.includes(provider as never)) {
      throw ApiException.notFound('Webhook provider not enabled.');
    }

    const typed = provider as WebhookProvider;
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (rawBody.length > this.config.webhooks.maxBodyBytes) {
      throw ApiException.validation('Webhook payload too large.');
    }

    const ok = await this.verifier.verify({
      provider: typed,
      rawBody,
      headers: req.headers,
    });
    const ctx = getApiContext(req);
    if (!ok) {
      await this.eventBus.publish(
        'api.auth.failed',
        {
          method: 'api-key',
          reason: `webhook_signature_invalid:${provider}`,
          ip: req.ip ?? null,
          requestId: ctx.requestId,
        },
        { actor: { type: 'api', id: 'webhook' } },
      );
      throw ApiException.webhookSignature();
    }

    const payload = (req.body ?? {}) as Record<string, unknown>;
    const record = await this.router.ingest({
      provider: typed,
      eventType: this.eventType(typed, req, payload),
      guildId: this.guildId(payload),
      signature: this.signature(typed, req),
      payload,
      requestId: ctx.requestId,
    });

    return { accepted: true, deliveryId: record.id };
  }

  private eventType(
    provider: WebhookProvider,
    req: Request,
    payload: Record<string, unknown>,
  ): string {
    if (provider === 'github') {
      const h = req.headers['x-github-event'];
      return typeof h === 'string' ? h : 'unknown';
    }
    const type = payload['type'] ?? payload['event'] ?? 'unknown';
    return typeof type === 'string' ? type : 'unknown';
  }

  private guildId(payload: Record<string, unknown>): string | null {
    const id = payload['guild_id'] ?? payload['guildId'];
    return typeof id === 'string' ? id : null;
  }

  private signature(provider: WebhookProvider, req: Request): string | null {
    const map: Record<WebhookProvider, string> = {
      discord: 'x-signature-ed25519',
      github: 'x-hub-signature-256',
      stripe: 'stripe-signature',
      fivem: 'x-fivem-signature',
    };
    const value = req.headers[map[provider]];
    return typeof value === 'string' ? value : null;
  }
}
