import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../core/events/event-bus';
import type {
  MetricSnapshotCreatedPayload,
  MetricThresholdBreachedPayload,
} from '../../../core/events/registry/payloads/metrics.payloads';
import { MetricsEvents } from './metrics.events';

/** Publishes the Metrics module's own alerting/rollup events on the bus. */
@Injectable()
export class MetricsEventEmitter {
  constructor(private readonly bus: EventBus) {}

  async emitThresholdBreached(
    payload: MetricThresholdBreachedPayload,
  ): Promise<void> {
    await this.bus.publish(MetricsEvents.ThresholdBreached, payload, {
      guildId: payload.guildId,
      actor: { type: 'system', id: 'metrics' },
    });
  }

  async emitSnapshotCreated(
    payload: MetricSnapshotCreatedPayload,
  ): Promise<void> {
    await this.bus.publish(MetricsEvents.SnapshotCreated, payload, {
      guildId: payload.guildId,
      actor: { type: 'system', id: 'metrics' },
    });
  }
}
