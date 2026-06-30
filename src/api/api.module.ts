import { Module } from '@nestjs/common';
// Config
import { API_CONFIG, resolveApiConfig } from './config/api.config';
// Auth
import { JwtService } from './auth/jwt.service';
import { SessionStore } from './auth/session.store';
import { DiscordOAuthService } from './auth/discord-oauth.service';
import { AuthService } from './auth/auth.service';
import { CompositeAuthGuard } from './auth/guards/composite-auth.guard';
import { GuildScopeGuard } from './auth/guards/guild-scope.guard';
import { ApiRateLimitGuard } from './auth/guards/rate-limit.guard';
import { ApiPermissionsGuard } from './auth/guards/permissions.guard';
import { AuthController } from './auth/auth.controller';
// Common interceptors/filters
import { EnvelopeInterceptor } from './common/envelope/envelope.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TraceInterceptor } from './common/interceptors/trace.interceptor';
import { CacheInterceptor } from './common/interceptors/cache.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
// Repositories
import {
  GuildLookupRepository,
  PrismaGuildLookupRepository,
} from './repositories/guild-lookup.repository';
import {
  WebhookDeliveryRepository,
  PrismaWebhookDeliveryRepository,
} from './repositories/webhook-delivery.repository';
// Realtime
import { RealtimeAuth } from './realtime/realtime.auth';
import { RealtimeGateway } from './realtime/realtime.gateway';
// Webhooks
import { SignatureVerifier } from './webhooks/signature.verifier';
import { WebhookRouterService } from './webhooks/webhook-router.service';
import { WebhooksController } from './webhooks/webhooks.controller';
// Health
import { ApiHealthController } from './health/health.controller';

/**
 * The API transport boundary. Depends only on CORE systems (Events, Cache,
 * Permissions, Database) and the cross-cutting `@shared/security` layer (API
 * keys, rate limiting, encryption) — it implements no domain logic.
 *
 * Guards, interceptors and the exception filter are applied at the controller
 * boundary via the `@ApiProtected()` / `@ApiPublic()` decorators rather than as
 * global APP_* providers, so the bot's other root-mounted controllers are
 * untouched.
 */
@Module({
  controllers: [AuthController, WebhooksController, ApiHealthController],
  providers: [
    { provide: API_CONFIG, useFactory: () => resolveApiConfig() },
    // Auth
    JwtService,
    SessionStore,
    DiscordOAuthService,
    AuthService,
    CompositeAuthGuard,
    GuildScopeGuard,
    ApiRateLimitGuard,
    ApiPermissionsGuard,
    // Interceptors / filter (referenced by the @ApiProtected decorator)
    EnvelopeInterceptor,
    LoggingInterceptor,
    TraceInterceptor,
    CacheInterceptor,
    GlobalExceptionFilter,
    // Repositories
    { provide: GuildLookupRepository, useClass: PrismaGuildLookupRepository },
    {
      provide: WebhookDeliveryRepository,
      useClass: PrismaWebhookDeliveryRepository,
    },
    // Realtime
    RealtimeAuth,
    RealtimeGateway,
    // Webhooks
    SignatureVerifier,
    WebhookRouterService,
  ],
  exports: [API_CONFIG, JwtService, SessionStore],
})
export class ApiModule {}
