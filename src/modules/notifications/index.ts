// Module class
export { NotificationsModule } from './notifications.module';

// Public application contract + wire types (the ONLY surface for in-process callers)
export {
  INotificationService,
  NotificationProvider,
  type NotificationChannel,
  type NotificationCategory,
  type NotificationPriority,
  type NotificationRecipient,
  type TemplateVars,
  type DispatchNotificationInput,
  type DispatchResult,
  type RenderedMessage,
  type ProviderSendResult,
} from './notifications.public';

// Event names & payload types (payload shapes live in the core event registry)
export {
  NotificationEvents,
  type NotificationEventName,
} from './events/notification.events';

// Claims (for guards in other surfaces, e.g. the dashboard BFF)
export { NotificationClaims } from './notifications.constants';
