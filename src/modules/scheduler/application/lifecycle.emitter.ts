import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../core/events/event-bus';
import {
  SchedulerEvents,
  type SchedulerEventName,
  type JobLifecyclePayload,
} from '../events/scheduler.events';
import type { ScheduleStatus } from '../domain/schedule.entity';

/** Publishes scheduler lifecycle events on the core Event Bus with a job actor. */
@Injectable()
export class SchedulerLifecycleEmitter {
  constructor(private readonly eventBus: EventBus) {}

  async emit(
    name: SchedulerEventName,
    params: {
      jobId: string;
      kind: string;
      guildId: string | null;
      status: ScheduleStatus;
      attempt: number;
      scheduledFor: Date;
      traceId: string;
      error?: { code: string; message: string };
    },
  ): Promise<void> {
    const payload: JobLifecyclePayload = {
      jobId: params.jobId,
      kind: params.kind,
      guildId: params.guildId,
      status: params.status,
      attempt: params.attempt,
      scheduledFor: params.scheduledFor.toISOString(),
      occurredAt: new Date().toISOString(),
      traceId: params.traceId,
      error: params.error,
    };
    await this.eventBus.publish(name, payload, {
      guildId: params.guildId,
      actor: { type: 'job', id: 'scheduler' },
      idempotencyKey: `${name}:${params.jobId}:${params.attempt}`,
    });
  }

  readonly events = SchedulerEvents;
}
