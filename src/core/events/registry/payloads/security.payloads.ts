export interface SecurityRateLimitExceededPayload {
  readonly key: string;
  readonly by: 'user' | 'guild' | 'ip' | 'api-key' | 'global';
  readonly route: string;
  readonly guildId: string | null;
}

export interface SecurityAuthFailedPayload {
  readonly method: 'session' | 'api-key' | 'jwt';
  readonly reason: string;
  readonly ip: string | null;
  readonly userId: string | null;
}

export interface SecurityPermissionDeniedPayload {
  readonly userId: string;
  readonly guildId: string | null;
  readonly claim: string;
  readonly route: string;
}

export interface SecuritySecretAccessedPayload {
  readonly name: string;
  readonly actor: string;
}

export interface SecurityKeyRotatedPayload {
  readonly keyId: string;
  readonly at: string;
}

export interface SecurityEventPayloads {
  'security.rate_limit.exceeded': SecurityRateLimitExceededPayload;
  'security.auth.failed': SecurityAuthFailedPayload;
  'security.permission.denied': SecurityPermissionDeniedPayload;
  'security.secret.accessed': SecuritySecretAccessedPayload;
  'security.encryption.key_rotated': SecurityKeyRotatedPayload;
}
