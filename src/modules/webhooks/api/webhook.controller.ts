import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { IncomingHttpHeaders } from 'http';
import {
  InboundWebhookService,
  PayloadTooLargeError,
} from '../application/inbound-webhook.service';
import { EndpointDisabledError } from '../domain/errors/endpoint-disabled.error';
import { SignatureInvalidError } from '../domain/errors/signature-invalid.error';

/**
 * Public inbound ingress. Excluded from Swagger (machine-to-machine) and NOT
 * behind the permission guard — a delivery is authenticated purely by its
 * unguessable path token plus the per-provider signature verified inside
 * {@link InboundWebhookService.accept}. The exact request bytes are read from
 * `req.rawBody` (main.ts sets `rawBody: true`) so HMAC verification never sees a
 * re-serialised body. The handler returns `202 Accepted` fast: verify + dedupe +
 * persist + enqueue happen in the service, normalization/fan-out run later in the
 * inbound worker. Error bodies never leak internals (secrets, raw body, stack).
 */
@ApiExcludeController()
@Controller('webhooks/in')
export class WebhookController {
  constructor(private readonly inbound: InboundWebhookService) {}

  @Post(':token')
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(
    @Req() req: RawBodyRequest<Request>,
    @Param('token') token: string,
  ): Promise<{ accepted: true }> {
    const raw = req.rawBody;
    if (!raw) {
      throw new BadRequestException('raw body unavailable');
    }

    try {
      await this.inbound.accept(token, raw, this.flattenHeaders(req.headers));
    } catch (err) {
      throw this.mapError(err);
    }
    return { accepted: true };
  }

  /**
   * Flattens Express's `IncomingHttpHeaders` (which may carry array-valued
   * headers) into the flat `string | undefined` shape the verifier/normalizer
   * expect. Array-valued headers collapse to their first element; the raw body is
   * untouched (HMAC still sees the exact bytes).
   */
  private flattenHeaders(
    headers: IncomingHttpHeaders,
  ): Readonly<Record<string, string | undefined>> {
    const out: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(headers)) {
      out[key] = Array.isArray(value) ? value[0] : value;
    }
    return out;
  }

  /**
   * Maps domain errors to HTTP without leaking internals. A bad signature is a
   * 401; an unknown/disabled endpoint is a 404 (indistinguishable from "never
   * existed"); an oversized body is a 413. Anything else rethrows so the global
   * filter renders a generic 500.
   */
  private mapError(err: unknown): Error {
    if (err instanceof SignatureInvalidError) {
      return new UnauthorizedException('invalid signature');
    }
    if (err instanceof EndpointDisabledError) {
      return new NotFoundException('endpoint not found');
    }
    if (err instanceof PayloadTooLargeError) {
      return new PayloadTooLargeException('payload too large');
    }
    return err instanceof Error ? err : new Error('inbound webhook failed');
  }
}
