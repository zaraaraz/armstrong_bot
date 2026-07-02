import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  GithubNotifierService,
  type GithubPushBody,
} from '../application/integration/github-notifier.service';

/**
 * GitHub webhook ingest. Excluded from Swagger (machine-to-machine) and NOT
 * behind the permission guard — authentication is the HMAC signature over the
 * raw body (`X-Hub-Signature-256`) validated against the configured secret.
 * Only the `push` event is fanned out; other events are accepted and ignored so
 * GitHub does not disable the hook.
 */
@ApiExcludeController()
@Controller('webhooks/github')
export class GithubWebhookController {
  constructor(private readonly github: GithubNotifierService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'GitHub webhook ingest (HMAC-authenticated)' })
  async ingest(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
  ): Promise<{ ok: boolean; ignored?: boolean }> {
    const raw = req.rawBody;
    if (!raw) {
      throw new BadRequestException('raw body unavailable');
    }
    if (!this.github.verifySignature(raw, signature)) {
      throw new UnauthorizedException('invalid signature');
    }
    if (event === 'ping') return { ok: true, ignored: true };
    if (event !== 'push') return { ok: true, ignored: true };

    const body = this.parse(raw);
    const result = await this.github.ingest(body);
    return { ok: result.accepted, ignored: !result.accepted };
  }

  private parse(raw: Buffer): GithubPushBody {
    try {
      return JSON.parse(raw.toString('utf8')) as GithubPushBody;
    } catch {
      throw new BadRequestException('invalid JSON body');
    }
  }
}
