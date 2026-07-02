import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import {
  INTEGRATION_POLL_JOB,
  NOTIFICATIONS_INTEGRATION_POLL_QUEUE,
} from '../notifications.constants';
import { NotificationsConfigService } from '../config/notifications-config.service';
import { TwitchNotifierService } from '../application/integration/twitch-notifier.service';
import { YoutubeNotifierService } from '../application/integration/youtube-notifier.service';
import { NotificationQueues, type IntegrationPollJobData } from './queues';

/**
 * BullMQ worker draining `notifications.integration-poll`. Two repeatable jobs
 * (TWITCH, YOUTUBE) are registered on boot at the configured intervals; each
 * fires the matching notifier's `poll()`, which fans out any new upstream item
 * exactly once. GitHub is webhook-driven and has no poll job.
 */
@Injectable()
export class IntegrationPollProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('notifications.integration.worker');
  private worker: Worker<IntegrationPollJobData> | null = null;

  constructor(
    private readonly queues: NotificationQueues,
    private readonly config: NotificationsConfigService,
    private readonly twitch: TwitchNotifierService,
    private readonly youtube: YoutubeNotifierService,
  ) {}

  onModuleInit(): void {
    const { integrations } = this.config.global();
    if (!integrations.enabled) {
      this.logger.debug('integrations disabled; poll worker idle');
      return;
    }
    this.worker = new Worker<IntegrationPollJobData>(
      NOTIFICATIONS_INTEGRATION_POLL_QUEUE,
      (job) => this.process(job),
      { connection: this.queues.connection, concurrency: 2 },
    );
    this.worker.on('error', (err) =>
      this.logger.warn(`worker error: ${err.message}`),
    );

    void this.registerPolls().catch((err: Error) =>
      this.logger.warn(`could not register poll jobs: ${err.message}`),
    );
  }

  private async registerPolls(): Promise<void> {
    const { integrations } = this.config.global();
    await this.queues.ensurePollJob('TWITCH', integrations.twitchPollSeconds);
    await this.queues.ensurePollJob('YOUTUBE', integrations.youtubePollSeconds);
  }

  private async process(job: Job<IntegrationPollJobData>): Promise<void> {
    if (job.name !== INTEGRATION_POLL_JOB) return;
    switch (job.data.provider) {
      case 'TWITCH':
        await this.twitch.poll();
        return;
      case 'YOUTUBE':
        await this.youtube.poll();
        return;
      default:
        return; // GITHUB is webhook-driven
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
