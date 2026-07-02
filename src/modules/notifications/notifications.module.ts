import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// Config
import { NotificationsConfigService } from './config/notifications-config.service';
// Domain
import { TemplateService } from './domain/template.service';
import { PreferenceResolver } from './domain/preference-resolver.service';
import { DedupeService } from './domain/dedupe.service';
// Infrastructure
import { NotificationRepository } from './infrastructure/notification.repository';
import { NotificationPreferenceRepository } from './infrastructure/notification-preference.repository';
import { NotificationTemplateRepository } from './infrastructure/notification-template.repository';
import { IntegrationSubscriptionRepository } from './infrastructure/integration-subscription.repository';
// Observability
import { NotificationsMetrics } from './observability/notifications.metrics';
import { NotificationsTracing } from './observability/notifications.tracing';
// Providers
import {
  NOTIFICATION_PROVIDERS,
  type NotificationProviderList,
} from './providers/provider.contract';
import { ProviderRegistry } from './providers/provider.registry';
import {
  DiscordChannelProvider,
  DiscordDmProvider,
} from './providers/discord.provider';
import { WebhookProvider } from './providers/webhook.provider';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
// Application
import { INotificationService } from './notifications.public';
import { NotificationService } from './application/notification.service';
import { NotificationRoutingService } from './application/notification-routing.service';
import { TwitchNotifierService } from './application/integration/twitch-notifier.service';
import { YoutubeNotifierService } from './application/integration/youtube-notifier.service';
import { GithubNotifierService } from './application/integration/github-notifier.service';
// Jobs
import { NotificationQueues } from './jobs/queues';
import { DeliveryProcessor } from './jobs/delivery.processor';
import { DigestProcessor } from './jobs/digest.processor';
import { IntegrationPollProcessor } from './jobs/integration-poll.processor';
// Events
import { NotificationEventEmitter } from './events/notification-event.emitter';
import { DomainEventConsumer } from './events/consumers/domain-event.consumer';
// API
import { NotificationsController } from './api/notifications.controller';
import { PreferencesController } from './api/preferences.controller';
import { IntegrationsController } from './api/integrations.controller';
import { GithubWebhookController } from './api/github-webhook.controller';
// Commands
import { NotificationsCommands } from './commands/notifications.commands';

/**
 * Notifications module (Phase 4, item 17). The platform's single outbound
 * messaging system: one `NotificationProvider` contract, many transports,
 * i18n templating, per-user/guild preferences, and at-least-once delivery via
 * BullMQ with a DLQ. `@Global` so in-process callers can inject
 * {@link INotificationService} without importing the module.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [
    NotificationsController,
    PreferencesController,
    IntegrationsController,
    GithubWebhookController,
  ],
  providers: [
    // Config
    NotificationsConfigService,
    // Domain
    TemplateService,
    PreferenceResolver,
    DedupeService,
    // Infrastructure
    NotificationRepository,
    NotificationPreferenceRepository,
    NotificationTemplateRepository,
    IntegrationSubscriptionRepository,
    // Observability
    NotificationsMetrics,
    NotificationsTracing,
    // Providers (self-registering via the NOTIFICATION_PROVIDERS token)
    DiscordDmProvider,
    DiscordChannelProvider,
    WebhookProvider,
    EmailProvider,
    PushProvider,
    {
      provide: NOTIFICATION_PROVIDERS,
      useFactory: (
        dm: DiscordDmProvider,
        channel: DiscordChannelProvider,
        webhook: WebhookProvider,
        email: EmailProvider,
        push: PushProvider,
      ): NotificationProviderList => [dm, channel, webhook, email, push],
      inject: [
        DiscordDmProvider,
        DiscordChannelProvider,
        WebhookProvider,
        EmailProvider,
        PushProvider,
      ],
    },
    ProviderRegistry,
    // Application
    { provide: INotificationService, useClass: NotificationService },
    { provide: NotificationService, useExisting: INotificationService },
    NotificationRoutingService,
    TwitchNotifierService,
    YoutubeNotifierService,
    GithubNotifierService,
    // Jobs
    NotificationQueues,
    DeliveryProcessor,
    DigestProcessor,
    IntegrationPollProcessor,
    // Events
    NotificationEventEmitter,
    DomainEventConsumer,
    // Commands
    NotificationsCommands,
  ],
  exports: [INotificationService],
})
export class NotificationsModule {}
