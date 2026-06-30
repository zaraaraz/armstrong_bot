/**
 * Event payloads emitted by the Dashboard backend (`src/dashboard`).
 *
 * The dashboard reacts to module/core events for realtime fan-out and emits
 * `dashboard.*` events when an admin performs a write action. The Logging/Audit
 * core consumes these to write audit entries; modules may consume them to
 * invalidate their own caches. Names follow `module.entity.action`.
 */

/** A module was enabled/disabled from the dashboard. */
export interface DashboardModuleToggledPayload {
  readonly guildId: string;
  readonly moduleKey: string;
  readonly enabled: boolean;
  readonly actorDiscordId: string;
  readonly at: string;
}

/** A module's configuration was updated from the dashboard. */
export interface DashboardConfigUpdatedPayload {
  readonly guildId: string;
  readonly module: string;
  readonly keys: readonly string[];
  readonly actorDiscordId: string;
  readonly at: string;
}

/** An API key was created from the dashboard. */
export interface DashboardApiKeyCreatedPayload {
  readonly guildId: string;
  readonly apiKeyId: string;
  readonly actorDiscordId: string;
  readonly at: string;
}

/** A backup was requested from the dashboard. */
export interface DashboardBackupRequestedPayload {
  readonly guildId: string;
  readonly backupId: string;
  readonly actorDiscordId: string;
  readonly at: string;
}

export interface DashboardEventPayloads {
  'dashboard.module.toggled': DashboardModuleToggledPayload;
  'dashboard.config.updated': DashboardConfigUpdatedPayload;
  'dashboard.apikey.created': DashboardApiKeyCreatedPayload;
  'dashboard.backup.requested': DashboardBackupRequestedPayload;
}
