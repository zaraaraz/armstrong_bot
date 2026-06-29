import { SetMetadata } from '@nestjs/common';

export const COOLDOWN_KEY = 'ghost:security:cooldown';

/**
 * Declare a per-user cooldown (in seconds) on a handler. Enforced by the
 * consuming command/route guard via {@link CooldownService}.
 *
 * @example
 *   @Cooldown(5)
 */
export const Cooldown = (seconds: number): MethodDecorator =>
  SetMetadata(COOLDOWN_KEY, seconds);
