/** BullMQ queue names owned exclusively by the Webhooks module. */
export const WEBHOOKS_INBOUND_QUEUE = 'webhooks.inbound';
export const WEBHOOKS_OUTBOUND_QUEUE = 'webhooks.outbound';

/** BullMQ job names. */
export const INBOUND_PROCESS_JOB = 'process';
export const OUTBOUND_DELIVER_JOB = 'deliver';

/** Prefix for handlerIds used when subscribing to the core Event Bus. */
export const WEBHOOKS_HANDLER_PREFIX = 'webhooks';

/** Cache key parts (namespace `CacheNamespace.Generic`, per spec §7). */
export const WEBHOOKS_CACHE = {
  Endpoint: 'webhooks:endpoint',
  Subscriptions: 'webhooks:subs',
  Dedupe: 'webhooks:dedupe',
} as const;

/** Wildcard-capable claims under the `webhooks` namespace (parent grants all). */
export const WebhookClaims = {
  EndpointsRead: 'webhooks.endpoints.read',
  EndpointsManage: 'webhooks.endpoints.manage',
  DeliveriesRead: 'webhooks.deliveries.read',
  DeliveriesReplay: 'webhooks.deliveries.replay',
  SubscriptionsRead: 'webhooks.subscriptions.read',
  SubscriptionsManage: 'webhooks.subscriptions.manage',
} as const;

/** i18n catalogue namespace for webhook dashboard/command copy. */
export const WEBHOOKS_I18N_NAMESPACE = 'webhooks';
