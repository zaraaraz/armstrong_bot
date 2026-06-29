import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { EventBus } from '../../../core/events/event-bus';
import { ApiKeyService } from '../services/api-key.service';
import { SecurityEvents } from '../security.events';

/** Marks a route as requiring a valid API key. */
export const API_KEY_REQUIRED = 'ghost:security:api-key-required';

interface ApiKeyRequest extends Request {
  apiKey?: {
    id: string;
    guildId: string | null;
    scopes: readonly string[];
  };
}

/**
 * Authenticates requests via the `x-api-key` header (or `Authorization: Bearer`).
 * On success it attaches `req.apiKey`; on failure it publishes
 * `security.auth.failed` and throws 401. Only enforced on routes flagged with
 * the {@link API_KEY_REQUIRED} metadata.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyService,
    @Inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      API_KEY_REQUIRED,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<ApiKeyRequest>();
    const rawKey = this.extractKey(req);

    if (!rawKey) {
      await this.fail('missing', req);
      throw new UnauthorizedException('API key required');
    }

    const record = await this.apiKeys.authenticate(rawKey);
    if (!record) {
      await this.fail('invalid', req);
      throw new UnauthorizedException('Invalid API key');
    }

    req.apiKey = {
      id: record.id,
      guildId: record.guildId,
      scopes: record.scopes,
    };
    return true;
  }

  private extractKey(req: ApiKeyRequest): string | null {
    const header = req.headers['x-api-key'];
    if (typeof header === 'string' && header.length > 0) return header;

    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice('Bearer '.length);
    }
    return null;
  }

  private async fail(reason: string, req: ApiKeyRequest): Promise<void> {
    await this.eventBus.publish(
      SecurityEvents.AuthFailed,
      {
        method: 'api-key',
        reason,
        ip: req.ip ?? null,
        userId: null,
      },
      { actor: { type: 'system', id: 'security' } },
    );
  }
}
