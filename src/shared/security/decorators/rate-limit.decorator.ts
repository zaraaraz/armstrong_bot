import { SetMetadata } from '@nestjs/common';
import type { RateLimitOptions } from '../interfaces/security.interfaces';

export const RATE_LIMIT_KEY = 'ghost:security:rate-limit';

/**
 * Declare a rate limit on a route handler. Read by {@link RateLimitGuard}.
 *
 * @example
 *   @RateLimit({ points: 5, duration: 60, by: 'ip', blockFor: 300 })
 */
export const RateLimit = (options: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);
