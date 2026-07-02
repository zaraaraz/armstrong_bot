import { describe, expect, it, vi } from 'vitest';
import { AuditEventConsumer } from './audit-event.consumer';
import { makeFakeEventBus } from '../../../tests/fixtures/event-bus';
import { AUDIT_TAP_HANDLER_ID } from '../audit.constants';

describe('AuditEventConsumer', () => {
  it('taps the bus on init so every published envelope reaches ingest', async () => {
    const bus = makeFakeEventBus();
    const ingestEnvelope = vi.fn().mockResolvedValue(undefined);
    const consumer = new AuditEventConsumer(bus, {
      ingestEnvelope,
    } as never);

    consumer.onModuleInit();
    await bus.publish('tickets.ticket.closed', {
      ticketId: 't1',
    } as never);
    await bus.publish('scheduler.job.completed', {
      jobId: 'j1',
    } as never);

    expect(ingestEnvelope).toHaveBeenCalledTimes(2);
    expect(ingestEnvelope.mock.calls[0][0]).toMatchObject({
      name: 'tickets.ticket.closed',
    });
  });

  it('unsubscribes the tap on destroy', async () => {
    const bus = makeFakeEventBus();
    const ingestEnvelope = vi.fn().mockResolvedValue(undefined);
    const consumer = new AuditEventConsumer(bus, {
      ingestEnvelope,
    } as never);

    consumer.onModuleInit();
    consumer.onModuleDestroy();
    await bus.publish('tickets.ticket.closed', { ticketId: 't1' } as never);
    expect(ingestEnvelope).not.toHaveBeenCalled();
  });

  it('registers under the audit handler id', () => {
    const bus = makeFakeEventBus();
    const tap = vi.spyOn(bus, 'tap');
    const consumer = new AuditEventConsumer(bus, {
      ingestEnvelope: vi.fn(),
    } as never);
    consumer.onModuleInit();
    expect(tap).toHaveBeenCalledWith(
      AUDIT_TAP_HANDLER_ID,
      expect.any(Function),
    );
  });
});
