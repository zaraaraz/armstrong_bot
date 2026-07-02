/** BullMQ queue names owned exclusively by the Notifications module. */
export const NOTIFICATIONS_DELIVERY_QUEUE = 'notifications.delivery';
export const NOTIFICATIONS_DIGEST_QUEUE = 'notifications.digest';
export const NOTIFICATIONS_INTEGRATION_POLL_QUEUE =
  'notifications.integration-poll';

/** BullMQ job names. */
export const DELIVERY_JOB = 'deliver';
export const DIGEST_BUILD_JOB = 'digest-build';
export const INTEGRATION_POLL_JOB = 'integration-poll';

/** Prefix for handlerIds used when subscribing to the core Event Bus. */
export const NOTIFICATIONS_HANDLER_PREFIX = 'notifications';

/** Cache key parts (namespaced per section 7 of the spec). */
export const NOTIF_CACHE = {
  Template: 'notif:tmpl',
  Preference: 'notif:pref',
  RateLimit: 'notif:rl',
  Dedupe: 'notif:dedupe',
  PollCursor: 'notif:cursor',
} as const;

/** Wildcard-capable claims under the `notifications` namespace. */
export const NotificationClaims = {
  Dispatch: 'notifications.dispatch',
  Read: 'notifications.read',
  Cancel: 'notifications.cancel',
  PrefsRead: 'notifications.prefs.read',
  PrefsManage: 'notifications.prefs.manage',
  IntegrationsRead: 'notifications.integrations.read',
  IntegrationsManage: 'notifications.integrations.manage',
  TemplatesManage: 'notifications.templates.manage',
} as const;

/** i18n catalogue namespace for notification templates and command copy. */
export const NOTIFICATIONS_I18N_NAMESPACE = 'notifications';
