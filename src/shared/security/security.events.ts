/** Strongly-typed names for the security.* events this layer publishes. */
export const SecurityEvents = {
  RateLimitExceeded: 'security.rate_limit.exceeded',
  AuthFailed: 'security.auth.failed',
  PermissionDenied: 'security.permission.denied',
  SecretAccessed: 'security.secret.accessed',
  KeyRotated: 'security.encryption.key_rotated',
} as const;
