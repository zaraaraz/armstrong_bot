import { SetMetadata } from '@nestjs/common';

export const REQUIRE_CLAIMS_KEY = 'ghost:api:require-claims';

/**
 * Declares the permission claim(s) a route requires. All listed claims must be
 * satisfied (AND). The {@link ApiPermissionsGuard} matches them against the
 * actor's resolved claims using wildcard-aware comparison.
 *
 * @example @RequireClaims('tickets.read')
 * @example @RequireClaims('apikeys.create', 'apikeys.read')
 */
export const RequireClaims = (...claims: string[]) =>
  SetMetadata(REQUIRE_CLAIMS_KEY, claims);
