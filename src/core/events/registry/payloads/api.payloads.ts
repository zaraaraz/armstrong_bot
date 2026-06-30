/**
 * Event payloads emitted by the API transport boundary (`src/api`).
 *
 * The API unit owns no domain — these events bridge transport ⇄ Event Bus so
 * that observability, audit and realtime fan-out can react without the API
 * importing another module directly. Event names follow `module.entity.action`.
 */

/** Emitted once per completed HTTP request (success or error). */
export interface ApiRequestCompletedPayload {
  readonly requestId: string;
  readonly actorId: string | null;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly guildId: string | null;
}

/** Emitted on a failed authentication attempt at the API boundary. */
export interface ApiAuthFailedPayload {
  readonly method: 'session' | 'jwt' | 'api-key';
  readonly reason: string;
  readonly ip: string | null;
  readonly requestId: string;
}

/** Emitted when an API-key-authenticated request succeeds (drives lastUsedAt). */
export interface ApiKeyUsedPayload {
  readonly keyId: string;
  readonly guildId: string | null;
  readonly requestId: string;
}

/** Emitted when a verified inbound webhook is accepted. */
export interface ApiWebhookReceivedPayload {
  readonly provider: 'discord' | 'github' | 'stripe' | 'fivem';
  readonly eventType: string;
  readonly guildId: string | null;
  readonly deliveryId: string;
  readonly requestId: string;
  readonly receivedAt: string;
}

export interface ApiEventPayloads {
  'api.request.completed': ApiRequestCompletedPayload;
  'api.auth.failed': ApiAuthFailedPayload;
  'api.key.used': ApiKeyUsedPayload;
  'api.webhook.received': ApiWebhookReceivedPayload;
}
