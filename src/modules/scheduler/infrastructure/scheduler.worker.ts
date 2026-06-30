import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { SCHEDULER_QUEUE } from './queue.tokens';
import type { SchedulerJobData } from './scheduler.queue';
import { SchedulerQueue } from './scheduler.queue';
import { JobRegistry } from '../domain/job-registry';
import { ScheduleRepository } from '../infrastructure/schedule.repository';
import { SchedulerConfigService } from '../config/scheduler-config.service';
import { SchedulerLifecycleEmitter } from '../application/lifecycle.emitter';
import { SchedulerMetrics } from '../observability/scheduler.metrics';
import { SchedulerTracing } from '../observability/scheduler.tracing';
import { SchedulerHealthState } from '../application/scheduler-health.state';

/**
 * BullMQ worker for the scheduler queue. Resolves the handler from the registry,
 * runs it inside a trace span, records a `ScheduleRun`, emits lifecycle events,
 * and routes exhausted jobs to the DLQ via `scheduler.job.dead_lettered`.
 */
@Injectable()
export class SchedulerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerWorker.name);
  private worker!: Worker<SchedulerJobData>;

  constructor(
    private readonly queueWrapper: SchedulerQueue,
    private readonly registry: JobRegistry,
    private readonly repo: ScheduleRepository,
    private readonly config: SchedulerConfigService,
    private readonly emitter: SchedulerLifecycleEmitter,
    private readonly metrics: SchedulerMetrics,
    private readonly tracing: SchedulerTracing,
    private readonly health: SchedulerHealthState,
  ) {}

  onModuleInit(): void {
    const global = this.config.global();
    this.worker = new Worker<SchedulerJobData>(
      SCHEDULER_QUEUE,
      (job) => this.process(job),
      {
        connection: this.queueWrapper.connection,
        concurrency: global.concurrency,
      },
    );

    this.worker.on('ready', () => this.health.markWorkerUp(true));
    this.worker.on('closing', () => this.health.markWorkerUp(false));
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        `scheduler job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      );
    });
    this.health.markWorkerUp(true);
    this.logger.log(
      `SchedulerWorker started (concurrency=${global.concurrency})`,
    );
  }

  private async process(job: Job<SchedulerJobData>): Promise<void> {
    const data = job.data;
    const handler = this.registry.resolve(data.kind);
    const attempt = (job.attemptsMade ?? 0) + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    const scheduledFor = new Date(data.scheduledFor);

    if (!handler) {
      this.logger.error(
        `No handler registered for kind "${data.kind}" (schedule ${data.scheduleId})`,
      );
      throw new Error(`No handler for kind "${data.kind}"`);
    }

    const run = await this.repo.createRun({
      scheduleId: data.scheduleId,
      guildId: data.guildId,
      attempt,
      status: 'active',
      traceId: null,
    });

    const start = Date.now();
    await this.emitter.emit(this.emitter.events.Started, {
      jobId: data.scheduleId,
      kind: data.kind,
      guildId: data.guildId,
      status: 'active',
      attempt,
      scheduledFor,
      traceId: 'pending',
    });

    try {
      await this.tracing.withSpan(
        'scheduler.run',
        {
          'scheduler.job_id': data.scheduleId,
          'scheduler.kind': data.kind,
          'scheduler.guild_id': data.guildId ?? 'global',
          'scheduler.attempt': attempt,
        },
        async () => {
          const parsed = handler.parse(data.payload);
          await handler.handle(parsed, {
            jobId: data.scheduleId,
            jobKind: data.kind,
            guildId: data.guildId,
            attempt,
            scheduledFor,
            traceId: this.tracing.currentTraceId(),
          });
        },
      );

      const durationMs = Date.now() - start;
      await this.repo.finishRun(run.id, { status: 'completed', durationMs });
      await this.repo.update(data.scheduleId, {
        lastRunAt: new Date(),
        ...(await this.terminalStatusFor(data.scheduleId)),
      });
      this.metrics.recordRun(data.kind, 'completed', durationMs);
      await this.emitter.emit(this.emitter.events.Completed, {
        jobId: data.scheduleId,
        kind: data.kind,
        guildId: data.guildId,
        status: 'completed',
        attempt,
        scheduledFor,
        traceId: this.tracing.currentTraceId(),
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const durationMs = Date.now() - start;
      const willRetry = attempt < maxAttempts;

      await this.repo.finishRun(run.id, {
        status: 'failed',
        durationMs,
        error: error.message,
      });
      this.metrics.recordRun(
        data.kind,
        willRetry ? 'retried' : 'failed',
        durationMs,
      );

      await this.emitter.emit(
        willRetry ? this.emitter.events.Retried : this.emitter.events.Failed,
        {
          jobId: data.scheduleId,
          kind: data.kind,
          guildId: data.guildId,
          status: 'failed',
          attempt,
          scheduledFor,
          traceId: this.tracing.currentTraceId(),
          error: { code: error.name, message: error.message },
        },
      );

      if (!willRetry) {
        await this.repo
          .update(data.scheduleId, { status: 'failed' })
          .catch(() => undefined);
        await this.emitter.emit(this.emitter.events.DeadLettered, {
          jobId: data.scheduleId,
          kind: data.kind,
          guildId: data.guildId,
          status: 'failed',
          attempt,
          scheduledFor,
          traceId: this.tracing.currentTraceId(),
          error: { code: error.name, message: error.message },
        });
      }

      throw error; // let BullMQ apply backoff / mark failed
    }
  }

  /** A one-shot job completes terminally; recurring stays active. */
  private async terminalStatusFor(
    scheduleId: string,
  ): Promise<{ status?: 'completed' }> {
    const entity = await this.repo.findById(scheduleId, undefined);
    return entity?.type === 'once' ? { status: 'completed' } : {};
  }

  async onModuleDestroy(): Promise<void> {
    this.health.markWorkerUp(false);
    await this.worker?.close().catch(() => undefined);
  }
}
