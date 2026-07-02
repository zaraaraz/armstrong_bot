import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventBus, type Subscription } from '../../../core/events/event-bus';
import type { EventEnvelope } from '../../../core/events/envelope/event-envelope';
import { AUDIT_TAP_HANDLER_ID } from '../audit.constants';
import { AuditIngestService } from '../application/audit-ingest.service';

/**
 * The module's global sink: taps the Event Bus so every published envelope —
 * regardless of name or delivery policy — reaches the ingest pipeline.
 * The tap contract is fire-and-forget; ingest handles its own failures, so
 * an audit outage can never block or break the emitting module.
 */
@Injectable()
export class AuditEventConsumer implements OnModuleInit, OnModuleDestroy {
  private subscription: Subscription | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly ingest: AuditIngestService,
  ) {}

  onModuleInit(): void {
    this.subscription = this.eventBus.tap(
      AUDIT_TAP_HANDLER_ID,
      (envelope: EventEnvelope) => {
        void this.ingest.ingestEnvelope(envelope);
      },
    );
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
