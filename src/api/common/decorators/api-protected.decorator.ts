import {
  applyDecorators,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CompositeAuthGuard } from '../../auth/guards/composite-auth.guard';
import { GuildScopeGuard } from '../../auth/guards/guild-scope.guard';
import { ApiRateLimitGuard } from '../../auth/guards/rate-limit.guard';
import { ApiPermissionsGuard } from '../../auth/guards/permissions.guard';
import { EnvelopeInterceptor } from '../envelope/envelope.interceptor';
import { LoggingInterceptor } from '../interceptors/logging.interceptor';
import { TraceInterceptor } from '../interceptors/trace.interceptor';
import { CacheInterceptor } from '../interceptors/cache.interceptor';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';

/**
 * Composite decorator applied to API controllers. Establishes the defence-in-
 * depth order at the controller boundary — auth → guild scope → rate limit →
 * permissions — and the response pipeline (trace → logging → cache → envelope).
 *
 * Scoping these as controller decorators (rather than global APP_* providers)
 * keeps the cross-cutting concerns inside `src/api` so the bot's other
 * root-mounted controllers (health, events, plugins) are untouched.
 *
 * Guard execution order follows the order of the array; interceptors wrap in
 * declaration order (outermost first).
 */
export function ApiProtected(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    UseFilters(GlobalExceptionFilter),
    UseInterceptors(
      TraceInterceptor,
      LoggingInterceptor,
      CacheInterceptor,
      EnvelopeInterceptor,
    ),
    UseGuards(
      CompositeAuthGuard,
      GuildScopeGuard,
      ApiRateLimitGuard,
      ApiPermissionsGuard,
    ),
  );
}

/**
 * Lighter pipeline for unauthenticated, non-guild routes (health, webhook
 * ingress). Keeps the uniform error envelope, tracing and logging but no auth
 * or permission guards — those routes authenticate by other means (none, or a
 * provider signature).
 */
export function ApiPublic(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    UseFilters(GlobalExceptionFilter),
    UseInterceptors(TraceInterceptor, LoggingInterceptor, EnvelopeInterceptor),
  );
}
