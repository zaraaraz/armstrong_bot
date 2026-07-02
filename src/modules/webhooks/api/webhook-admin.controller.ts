import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { RestPermissionGuard } from '../../../core/permissions/guards/rest-permission.guard';
import { RequirePermission } from '../../../core/permissions/decorators/require-permission.decorator';
import { WebhookClaims } from '../webhooks.constants';
import {
  WebhookEndpointService,
  EndpointNotFoundError,
  type EndpointReveal,
  type EndpointView,
} from '../application/webhook-endpoint.service';
import {
  WebhookSubscriptionService,
  SubscriptionNotFoundError,
  EventTypeNotAllowedError,
  type SubscriptionView,
} from '../application/webhook-subscription.service';
import {
  WebhookDeliveryRepository,
  type IngressDeliveryRecord,
  type IngressDeliveryQuery,
} from '../repositories/webhook-delivery.repository';
import { WebhooksQueues } from '../jobs/webhooks.queue';
import type { WebhookProvider } from '../domain/webhook-provider.enum';
import type { DeliveryStatus } from '../domain/delivery-status.enum';
import { createEndpointSchema } from '../dto/create-endpoint.dto';
import { updateEndpointSchema } from '../dto/update-endpoint.dto';
import { createSubscriptionSchema } from '../dto/create-subscription.dto';
import { deliveryQuerySchema } from '../dto/delivery-query.dto';
import { replayDeliverySchema } from '../dto/replay-delivery.dto';
import {
  DeliveryResponseDto,
  EndpointResponseDto,
  EndpointSecretResponseDto,
  PagedDeliveriesDto,
  SubscriptionResponseDto,
} from '../dto/webhook-response.dto';

/**
 * The authenticated caller. Guild scope is resolved from `req.user.guildId`
 * (the audit/notifications precedent), NOT a `/guilds/:guildId` path param — the
 * spec's path shape is recorded as an as-built delta in the module summary.
 */
interface ScopedRequest extends Request {
  user?: { id: string; guildId?: string | null };
}

/**
 * Dashboard-facing admin surface for the Webhooks module (spec §10). Every route
 * is gated by a `webhooks.*` claim via {@link RestPermissionGuard} and scoped to
 * the caller's guild. Bodies are Zod-parsed at the boundary; controller stays
 * thin — all business logic lives in the application services. Signing secrets
 * and ingress tokens are revealed EXACTLY ONCE (create/rotate) and never echoed
 * back afterwards.
 */
@ApiTags('Webhooks')
@Controller('api/v1/webhooks')
@UseGuards(RestPermissionGuard)
export class WebhookAdminController {
  constructor(
    private readonly endpoints: WebhookEndpointService,
    private readonly subscriptions: WebhookSubscriptionService,
    private readonly deliveries: WebhookDeliveryRepository,
    private readonly queues: WebhooksQueues,
  ) {}

  // --- Endpoints -----------------------------------------------------------

  @Get('endpoints')
  @RequirePermission(WebhookClaims.EndpointsRead)
  @ApiOperation({ summary: 'List inbound endpoints for the guild (paginated)' })
  @ApiOkResponse({ type: [EndpointResponseDto] })
  async listEndpoints(
    @Query() raw: Record<string, string>,
    @Req() req: ScopedRequest,
  ): Promise<EndpointResponseDto[]> {
    const guildId = this.requireGuild(req);
    const q = deliveryQuerySchema.parse(raw ?? {});
    const paged = await this.endpoints.list(guildId, q.page, q.pageSize);
    return paged.items.map((e) => this.toEndpointView(e));
  }

  @Post('endpoints')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(WebhookClaims.EndpointsManage)
  @ApiOperation({
    summary: 'Create an inbound endpoint (reveals token + secret)',
  })
  @ApiOkResponse({ type: EndpointSecretResponseDto })
  async createEndpoint(
    @Body() body: unknown,
    @Req() req: ScopedRequest,
  ): Promise<EndpointSecretResponseDto> {
    const guildId = this.requireGuild(req);
    const dto = createEndpointSchema.parse(body ?? {});
    const reveal = await this.endpoints.createEndpoint(
      guildId,
      this.requireUserId(req),
      dto,
    );
    return this.toEndpointReveal(reveal);
  }

  @Patch('endpoints/:id')
  @RequirePermission(WebhookClaims.EndpointsManage)
  @ApiOperation({ summary: 'Enable/disable or relabel an inbound endpoint' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: EndpointResponseDto })
  async updateEndpoint(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: ScopedRequest,
  ): Promise<EndpointResponseDto> {
    const guildId = this.requireGuild(req);
    const dto = updateEndpointSchema.parse(body ?? {});
    try {
      const view = await this.endpoints.updateEndpoint(guildId, id, dto);
      return this.toEndpointView(view);
    } catch (err) {
      throw this.mapNotFound(err);
    }
  }

  @Post('endpoints/:id/rotate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(WebhookClaims.EndpointsManage)
  @ApiOperation({ summary: 'Rotate an endpoint token + secret (reveals both)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: EndpointSecretResponseDto })
  async rotateEndpoint(
    @Param('id') id: string,
    @Req() req: ScopedRequest,
  ): Promise<EndpointSecretResponseDto> {
    const guildId = this.requireGuild(req);
    try {
      const reveal = await this.endpoints.rotate(guildId, id);
      return this.toEndpointReveal(reveal);
    } catch (err) {
      throw this.mapNotFound(err);
    }
  }

  @Delete('endpoints/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(WebhookClaims.EndpointsManage)
  @ApiOperation({ summary: 'Soft-delete an inbound endpoint' })
  @ApiParam({ name: 'id' })
  async deleteEndpoint(
    @Param('id') id: string,
    @Req() req: ScopedRequest,
  ): Promise<void> {
    const guildId = this.requireGuild(req);
    try {
      await this.endpoints.softDelete(guildId, id);
    } catch (err) {
      throw this.mapNotFound(err);
    }
  }

  // --- Deliveries ----------------------------------------------------------

  @Get('deliveries')
  @RequirePermission(WebhookClaims.DeliveriesRead)
  @ApiOperation({ summary: 'Delivery log (paginated, filterable)' })
  @ApiOkResponse({ type: PagedDeliveriesDto })
  async listDeliveries(
    @Query() raw: Record<string, string>,
    @Req() req: ScopedRequest,
  ): Promise<PagedDeliveriesDto> {
    const guildId = this.requireGuild(req);
    const q = deliveryQuerySchema.parse(raw ?? {});
    const query: IngressDeliveryQuery = {
      guildId,
      page: q.page,
      pageSize: q.pageSize,
      provider: q.provider as WebhookProvider | undefined,
      status: q.status as DeliveryStatus | undefined,
      eventType: q.eventType,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    };
    const paged = await this.deliveries.listIngress(query);
    return {
      items: paged.items.map((d) => this.toDeliveryView(d)),
      page: paged.page,
      pageSize: paged.pageSize,
      total: paged.total,
    };
  }

  @Post('deliveries/:id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(WebhookClaims.DeliveriesReplay)
  @ApiOperation({ summary: 'Re-enqueue a delivery from its stored raw body' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: DeliveryResponseDto })
  async replayDelivery(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: ScopedRequest,
  ): Promise<DeliveryResponseDto> {
    const guildId = this.requireGuild(req);
    // Parsed for shape validation; verification is already done — the persisted
    // row is `verified`, so replay re-runs normalization + fan-out only.
    replayDeliverySchema.parse(body ?? {});

    const delivery = await this.deliveries.findIngressById(id);
    if (!delivery || delivery.guildId !== guildId) {
      throw new NotFoundException('delivery not found');
    }
    // Re-enqueue the inbound process job from the stored raw body. The jobId is
    // derived from the delivery id so a duplicate replay collapses onto one job;
    // the worker calls InboundWebhookService.process, which never re-verifies.
    await this.queues.enqueueInboundProcess({
      internalDeliveryId: delivery.id,
    });
    return this.toDeliveryView(delivery);
  }

  // --- Subscriptions -------------------------------------------------------

  @Get('subscriptions')
  @RequirePermission(WebhookClaims.SubscriptionsRead)
  @ApiOperation({ summary: 'List outbound subscriptions for the guild' })
  @ApiOkResponse({ type: [SubscriptionResponseDto] })
  async listSubscriptions(
    @Req() req: ScopedRequest,
  ): Promise<SubscriptionResponseDto[]> {
    const guildId = this.requireGuild(req);
    const views = await this.subscriptions.list(guildId);
    return views.map((s) => this.toSubscriptionView(s));
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(WebhookClaims.SubscriptionsManage)
  @ApiOperation({ summary: 'Subscribe the guild to an allowlisted event' })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  async createSubscription(
    @Body() body: unknown,
    @Req() req: ScopedRequest,
  ): Promise<SubscriptionResponseDto> {
    const guildId = this.requireGuild(req);
    const dto = createSubscriptionSchema.parse(body ?? {});
    try {
      const view = await this.subscriptions.create(
        guildId,
        this.requireUserId(req),
        dto,
      );
      return this.toSubscriptionView(view);
    } catch (err) {
      if (err instanceof EventTypeNotAllowedError) {
        throw new ForbiddenException('event type not allowed');
      }
      throw this.mapNotFound(err);
    }
  }

  @Delete('subscriptions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(WebhookClaims.SubscriptionsManage)
  @ApiOperation({ summary: 'Soft-delete an outbound subscription' })
  @ApiParam({ name: 'id' })
  async deleteSubscription(
    @Param('id') id: string,
    @Req() req: ScopedRequest,
  ): Promise<void> {
    const guildId = this.requireGuild(req);
    try {
      await this.subscriptions.remove(guildId, id);
    } catch (err) {
      throw this.mapNotFound(err);
    }
  }

  // --- Helpers -------------------------------------------------------------

  /** Resolves the caller's guild or refuses the request (guild-scoped surface). */
  private requireGuild(req: ScopedRequest): string {
    const guildId = req.user?.guildId;
    if (!guildId) {
      throw new ForbiddenException('webhooks are guild-scoped');
    }
    return guildId;
  }

  /** Resolves the acting user id for audit-bearing writes. */
  private requireUserId(req: ScopedRequest): string {
    const id = req.user?.id;
    if (!id) {
      throw new ForbiddenException('authentication required');
    }
    return id;
  }

  /** Maps service not-found errors to a 404 (scope mismatch == missing). */
  private mapNotFound(err: unknown): Error {
    if (
      err instanceof EndpointNotFoundError ||
      err instanceof SubscriptionNotFoundError
    ) {
      return new NotFoundException('resource not found');
    }
    return err instanceof Error
      ? err
      : new Error('webhook admin request failed');
  }

  private toEndpointView(view: EndpointView): EndpointResponseDto {
    return {
      id: view.id,
      provider: view.provider,
      label: view.label,
      enabled: view.enabled,
      guildId: view.guildId,
      createdAt: view.createdAt.toISOString(),
    };
  }

  private toEndpointReveal(reveal: EndpointReveal): EndpointSecretResponseDto {
    return {
      ...this.toEndpointView(reveal),
      token: reveal.token,
      signingSecret: reveal.signingSecret,
    };
  }

  private toDeliveryView(record: IngressDeliveryRecord): DeliveryResponseDto {
    return {
      id: record.id,
      provider: record.provider,
      eventType: record.eventType,
      status: record.status,
      externalId: record.externalId,
      attempts: record.attempts,
      receivedAt: record.receivedAt.toISOString(),
      processedAt: record.processedAt?.toISOString() ?? null,
    };
  }

  private toSubscriptionView(view: SubscriptionView): SubscriptionResponseDto {
    return {
      id: view.id,
      eventType: view.eventType,
      targetUrl: view.targetUrl,
      enabled: view.enabled,
      createdAt: view.createdAt.toISOString(),
    };
  }
}
