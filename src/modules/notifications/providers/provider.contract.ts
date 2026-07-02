import { NotificationProvider } from '../notifications.public';

/**
 * The transport contract lives in the public surface (so in-process callers and
 * future drop-in providers share one type). This file re-exports it for
 * internal imports and defines the DI multi-provider token the registry uses to
 * collect every registered transport.
 */
export { NotificationProvider } from '../notifications.public';

/** Injection token for the array of all registered {@link NotificationProvider}s. */
export const NOTIFICATION_PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');

export type NotificationProviderList = readonly NotificationProvider[];
