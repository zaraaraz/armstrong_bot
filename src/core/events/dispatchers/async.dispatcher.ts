import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import type { EventEnvelope } from '../envelope/event-envelope';
import type { EventName } from '../registry/event-map';
import type {
  EventHandler,
  SubscribeOptions,
  Subscription,
} from '../event-bus';
import { EventLogRepository } from '../repositories/event-log.repository';
import { DeadLetterRepository } from '../repositories/dead-letter.repository';

const QUEUE_NAME = 'ghost.events';

interface AsyncRegistration<K extends EventName> {
  handler: EventHandler<K>;
  options: SubscribeOptions;
}

@Injectable()
export class AsyncDispatcher implements OnModuleInit {
  private readonly logger = new Logger(AsyncDispatcher.name);
  private readonly registry = new Map<
    string,
    Set<AsyncRegistration<EventName>>
  >();
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly eventLogRepo: EventLogRepository,
    private readonly deadLetterRepo: DeadLetterRepository,
  ) {}

  onModuleInit() {
    const connection = {
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
    };

    this.queue = new Queue(QUEUE_NAME, { connection });

    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job<EventEnvelope>) => {
        await this.processJob(job);
      },
      {
        connection,
        concurrency: 10,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed permanently`, err);
    });
  }

  subscribe<K extends EventName>(
    name: K,
    handler: EventHandler<K>,
    options: SubscribeOptions,
  ): Subscription {
    if (!this.registry.has(name)) this.registry.set(name, new Set());
    const reg: AsyncRegistration<K> = { handler, options };
    this.registry.get(name)!.add(reg);

    return {
      handlerId: options.handlerId,
      unsubscribe: () => this.registry.get(name)?.delete(reg),
    };
  }

  async enqueue<K extends EventName>(
    envelope: EventEnvelope<K>,
  ): Promise<void> {
    await this.queue.add(envelope.name, envelope, {
      jobId: envelope.idempotencyKey ?? envelope.id,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    });
    this.logger.log(`Enqueued ${envelope.name} envelopeId=${envelope.id}`);
  }

  private async processJob(job: Job<EventEnvelope>): Promise<void> {
    const envelope = job.data;
    const registrations = this.registry.get(envelope.name);
    if (!registrations || registrations.size === 0) return;

    for (const reg of registrations) {
      if (reg.options.guildId && reg.options.guildId !== envelope.guildId)
        continue;

      try {
        await reg.handler(envelope);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const willRetry =
          (job.attemptsMade ?? 0) < (job.opts?.attempts ?? 5) - 1;

        this.logger.warn(
          `Handler ${reg.options.handlerId} failed (attempt ${job.attemptsMade}) for ${envelope.name} willRetry=${willRetry}`,
        );

        if (!willRetry) {
          await this.deadLetterRepo.create(
            envelope,
            reg.options.handlerId,
            job.attemptsMade ?? 1,
            error,
          );
          await this.eventLogRepo
            .updateStatus(envelope.id, 'failed')
            .catch(() => undefined);
        }

        throw error;
      }
    }

    await this.eventLogRepo
      .updateStatus(envelope.id, 'dispatched')
      .catch(() => undefined);
  }
}
