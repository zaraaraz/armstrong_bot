import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SchedulerService } from './scheduler.service.contract';
import {
  scheduleOnceSchema,
  type ScheduleOnceInput,
} from './dto/schedule-once.dto';
import {
  scheduleRecurringSchema,
  type ScheduleRecurringInput,
} from './dto/schedule-recurring.dto';
import { ScheduleRepository } from '../infrastructure/schedule.repository';
import { SchedulerQueue } from '../infrastructure/scheduler.queue';
import { SchedulerDomainService } from '../domain/scheduler.domain-service';
import { SchedulerConfigService } from '../config/scheduler-config.service';
import { SchedulerLifecycleEmitter } from './lifecycle.emitter';
import { SchedulerTracing } from '../observability/scheduler.tracing';
import {
  toJobRef,
  type ScheduleEntity,
  type ScheduledJobRef,
} from '../domain/schedule.entity';

/**
 * Public application service implementing the scheduling contract. Validates
 * input, writes the durable record, then enqueues through the Scheduler's own
 * BullMQ wrapper. No consumer ever sees Redis/BullMQ.
 */
@Injectable()
export class SchedulerServiceImpl extends SchedulerService {
  private readonly logger = new Logger(SchedulerServiceImpl.name);

  constructor(
    private readonly repo: ScheduleRepository,
    private readonly queue: SchedulerQueue,
    private readonly domain: SchedulerDomainService,
    private readonly config: SchedulerConfigService,
    private readonly emitter: SchedulerLifecycleEmitter,
    private readonly tracing: SchedulerTracing,
  ) {
    super();
  }

  async scheduleOnce<T>(raw: ScheduleOnceInput<T>): Promise<ScheduledJobRef> {
    const input = scheduleOnceSchema.parse(raw);
    const global = this.config.global();
    const guildConfig = await this.config.forGuild(input.guildId);

    const baseRunAt =
      input.runAt ?? new Date(Date.now() + (input.delayMs ?? 0));

    // Defer past an open maintenance window if applicable.
    const { runAt, deferred } = this.domain.resolveAgainstMaintenance({
      runAt: baseRunAt,
      deferrable: input.deferrableInMaintenance,
      guildConfig,
    });

    const dedupKey = input.idempotencyKey
      ? this.domain.deriveIdempotencyKey({
          guildId: input.guildId,
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
        })
      : null;

    // Idempotent replace: re-scheduling with the same key replaces the pending job.
    if (input.idempotencyKey) {
      const existing = await this.repo.findByDedup(
        input.guildId,
        input.kind,
        input.idempotencyKey,
      );
      if (existing && existing.status === 'pending') {
        await this.removeFromQueue(existing);
        await this.repo.softDelete(existing.id);
      }
    }

    const entity = await this.repo.create({
      guildId: input.guildId,
      kind: input.kind,
      type: 'once',
      status: 'pending',
      payload: input.payload,
      idempotencyKey: input.idempotencyKey ?? null,
      cron: null,
      everyMs: null,
      timezone: guildConfig.timezone,
      nextRunAt: runAt,
      deferrable: input.deferrableInMaintenance,
      maxAttempts: input.maxAttempts ?? global.defaultMaxAttempts,
      bullJobId: null,
    });

    const policy = this.domain.retryPolicy(global, entity.maxAttempts);
    await this.queue.addOnce(
      dedupKey ?? entity.id,
      {
        scheduleId: entity.id,
        kind: entity.kind,
        guildId: entity.guildId,
        payload: entity.payload,
        scheduledFor: runAt.toISOString(),
      },
      runAt.getTime() - Date.now(),
      {
        attempts: policy.attempts,
        backoff: policy.backoff,
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    );

    await this.repo.update(entity.id, { bullJobId: dedupKey ?? entity.id });

    const traceId = this.tracing.currentTraceId();
    await this.emitter.emit(this.emitter.events.Scheduled, {
      jobId: entity.id,
      kind: entity.kind,
      guildId: entity.guildId,
      status: 'pending',
      attempt: 0,
      scheduledFor: runAt,
      traceId,
    });
    if (deferred) {
      await this.emitter.emit(this.emitter.events.Deferred, {
        jobId: entity.id,
        kind: entity.kind,
        guildId: entity.guildId,
        status: 'pending',
        attempt: 0,
        scheduledFor: runAt,
        traceId,
      });
    }

    return toJobRef({ ...entity, nextRunAt: runAt });
  }

  async scheduleRecurring<T>(
    raw: ScheduleRecurringInput<T>,
  ): Promise<ScheduledJobRef> {
    const input = scheduleRecurringSchema.parse(raw);
    const global = this.config.global();
    const guildConfig = await this.config.forGuild(input.guildId);
    const timezone = input.timezone ?? guildConfig.timezone;

    const nextRunAt = this.domain.computeNextRun({
      cron: input.cron,
      everyMs: input.everyMs,
      timezone,
      from: new Date(),
    });

    // Idempotent replace for recurring: same dedup tuple => replace definition.
    const existing = await this.repo.findByDedup(
      input.guildId,
      input.kind,
      input.idempotencyKey,
    );
    if (existing) {
      await this.removeFromQueue(existing);
      await this.repo.softDelete(existing.id);
    }

    const entity = await this.repo.create({
      guildId: input.guildId,
      kind: input.kind,
      type: 'recurring',
      status: 'active',
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      cron: input.cron ?? null,
      everyMs: input.everyMs ?? null,
      timezone,
      nextRunAt,
      deferrable: input.deferrableInMaintenance,
      maxAttempts: input.maxAttempts ?? global.defaultMaxAttempts,
      bullJobId: null,
    });

    const repeatKey = await this.enqueueRecurring(entity);
    await this.repo.update(entity.id, { bullJobId: repeatKey });

    await this.emitter.emit(this.emitter.events.Scheduled, {
      jobId: entity.id,
      kind: entity.kind,
      guildId: entity.guildId,
      status: 'active',
      attempt: 0,
      scheduledFor: nextRunAt ?? new Date(),
      traceId: this.tracing.currentTraceId(),
    });

    return toJobRef(entity);
  }

  /** Enqueue (or re-enqueue) a recurring schedule into BullMQ. Used by reconciler too. */
  async enqueueRecurring(entity: ScheduleEntity): Promise<string> {
    const global = this.config.global();
    const policy = this.domain.retryPolicy(global, entity.maxAttempts);
    const repeat = entity.cron
      ? { pattern: entity.cron, tz: entity.timezone }
      : { every: entity.everyMs ?? 60_000 };

    return this.queue.addRecurring(
      entity.kind,
      {
        scheduleId: entity.id,
        kind: entity.kind,
        guildId: entity.guildId,
        payload: entity.payload,
        scheduledFor: (entity.nextRunAt ?? new Date()).toISOString(),
      },
      repeat,
      {
        attempts: policy.attempts,
        backoff: policy.backoff,
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    );
  }

  async cancel(jobId: string, guildId: string | null): Promise<boolean> {
    const entity = await this.requireJob(jobId, guildId);
    await this.removeFromQueue(entity);
    await this.repo.softDelete(entity.id);
    await this.emitter.emit(this.emitter.events.Cancelled, {
      jobId: entity.id,
      kind: entity.kind,
      guildId: entity.guildId,
      status: 'cancelled',
      attempt: 0,
      scheduledFor: entity.nextRunAt ?? new Date(),
      traceId: this.tracing.currentTraceId(),
    });
    return true;
  }

  async pause(jobId: string, guildId: string | null): Promise<boolean> {
    const entity = await this.requireJob(jobId, guildId);
    if (entity.type !== 'recurring') {
      throw new BadRequestException('Only recurring jobs can be paused');
    }
    await this.removeFromQueue(entity);
    await this.repo.update(entity.id, { status: 'paused', bullJobId: null });
    return true;
  }

  async resume(jobId: string, guildId: string | null): Promise<boolean> {
    const entity = await this.requireJob(jobId, guildId);
    if (entity.status !== 'paused') {
      throw new BadRequestException('Job is not paused');
    }
    const repeatKey = await this.enqueueRecurring(entity);
    await this.repo.update(entity.id, {
      status: 'active',
      bullJobId: repeatKey,
    });
    return true;
  }

  async triggerNow(jobId: string, guildId: string | null): Promise<void> {
    const entity = await this.requireJob(jobId, guildId);
    const global = this.config.global();
    const policy = this.domain.retryPolicy(global, entity.maxAttempts);
    await this.queue.addImmediate(
      {
        scheduleId: entity.id,
        kind: entity.kind,
        guildId: entity.guildId,
        payload: entity.payload,
        scheduledFor: new Date().toISOString(),
      },
      {
        attempts: policy.attempts,
        backoff: policy.backoff,
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    );
  }

  async get(
    jobId: string,
    guildId: string | null,
  ): Promise<ScheduledJobRef | null> {
    const entity = await this.repo.findById(jobId, guildId);
    return entity ? toJobRef(entity) : null;
  }

  private async requireJob(
    jobId: string,
    guildId: string | null,
  ): Promise<ScheduleEntity> {
    const entity = await this.repo.findById(jobId, guildId);
    if (!entity) throw new NotFoundException(`Schedule ${jobId} not found`);
    return entity;
  }

  private async removeFromQueue(entity: ScheduleEntity): Promise<void> {
    if (!entity.bullJobId) return;
    if (entity.type === 'recurring') {
      await this.queue.removeRepeatable(entity.bullJobId);
    } else {
      await this.queue.removeJob(entity.bullJobId);
    }
  }
}
