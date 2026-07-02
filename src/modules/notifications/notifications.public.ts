/**
 * Public surface of the Notifications module — the ONLY symbols other parts of
 * the platform may import. All transport-specific types stay internal to the
 * module. In-process callers (routing, integration notifiers, other modules)
 * depend solely on {@link INotificationService} + these contracts.
 */

// ─── Wire / contract types ───────────────────────────────────────────────────

export type NotificationChannel =
  'DISCORD_DM' | 'DISCORD_CHANNEL' | 'WEBHOOK' | 'EMAIL' | 'PUSH';

export type NotificationCategory =
  'system' | 'moderation' | 'tickets' | 'integrations' | 'digest' | 'marketing';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';

export interface NotificationRecipient {
  /** Discord user id when targeting a person; omit for channel/global sends. */
  readonly userId?: string;
  /** Discord channel id for DISCORD_CHANNEL sends. */
  readonly channelId?: string;
  /** Resolved when the email channel is requested. */
  readonly email?: string;
  /** Web-push subscription endpoint (JSON string) for PUSH sends. */
  readonly pushEndpoint?: string;
  /** Absolute URL for WEBHOOK sends. */
  readonly webhookUrl?: string;
}

/** Variables interpolated into the template; values are scalars only. */
export type TemplateVars = Readonly<
  Record<string, string | number | boolean | Date>
>;

export interface DispatchNotificationInput {
  readonly guildId: string | null; // null => global/platform notification
  readonly category: NotificationCategory;
  readonly priority?: NotificationPriority; // default 'normal'
  readonly templateKey: string; // e.g. 'integrations.twitch.online'
  readonly vars: TemplateVars;
  readonly recipients: ReadonlyArray<NotificationRecipient>;
  /** Force specific channels; otherwise resolved from preferences. */
  readonly channels?: ReadonlyArray<NotificationChannel>;
  /** Idempotency guard across retries / duplicate events. */
  readonly dedupeKey?: string;
  /** Optional locale override; otherwise resolved per recipient. */
  readonly localeOverride?: string;
}

export interface DispatchResult {
  readonly notificationId: string;
  readonly enqueuedDeliveries: number;
  readonly skipped: ReadonlyArray<{
    channel: NotificationChannel;
    reason: string;
  }>;
}

/** Public application API consumed in-process by routing + integration notifiers. */
export abstract class INotificationService {
  abstract dispatch(input: DispatchNotificationInput): Promise<DispatchResult>;
  abstract cancelPending(notificationId: string): Promise<void>;
}

/** Rendered, transport-agnostic message handed to a provider. */
export interface RenderedMessage {
  readonly subject: string | null; // used by email; null for chat transports
  readonly body: string;
  readonly locale: string;
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
}

/** Outcome a provider returns for a single delivery attempt. */
export interface ProviderSendResult {
  readonly ok: boolean;
  readonly providerMessageId?: string;
  readonly retryable: boolean;
  readonly error?: string;
}

/** Every transport implements this. Registered into ProviderRegistry via DI. */
export abstract class NotificationProvider {
  abstract readonly channel: NotificationChannel;
  abstract send(
    recipient: NotificationRecipient,
    message: RenderedMessage,
    guildId: string | null,
  ): Promise<ProviderSendResult>;
  /** Lightweight health probe surfaced to metrics + dashboard. */
  abstract healthCheck(): Promise<{ healthy: boolean; detail?: string }>;
}
