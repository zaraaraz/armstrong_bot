import { WebhookRouterService } from './webhook-router.service';
import type {
  WebhookDeliveryRepository,
  WebhookDeliveryRecord,
} from '../repositories/webhook-delivery.repository';
import type { EventBus } from '../../core/events/event-bus';

function record(): WebhookDeliveryRecord {
  return {
    id: 'd1',
    provider: 'github',
    eventType: 'push',
    guildId: null,
    status: 'received',
    attempts: 0,
    requestId: 'r1',
    receivedAt: new Date('2026-06-30T00:00:00Z'),
    processedAt: null,
    error: null,
  };
}

const input = {
  provider: 'github' as const,
  eventType: 'push',
  guildId: null,
  signature: 'sha256=x',
  payload: { a: 1 },
  requestId: 'r1',
};

describe('WebhookRouterService', () => {
  it('persists the delivery, emits the event, and marks processed', async () => {
    const markProcessed = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue(undefined);
    const repo = {
      create: () => Promise.resolve(record()),
      markProcessed,
      markFailed: vi.fn(),
    } as unknown as WebhookDeliveryRepository;
    const bus = { publish } as unknown as EventBus;
    const svc = new WebhookRouterService(repo, bus);

    const result = await svc.ingest(input);
    expect(result.id).toBe('d1');
    expect(publish).toHaveBeenCalledWith(
      'api.webhook.received',
      expect.objectContaining({ provider: 'github', deliveryId: 'd1' }),
      expect.objectContaining({ idempotencyKey: 'd1' }),
    );
    expect(markProcessed).toHaveBeenCalledWith('d1');
  });

  it('marks the delivery failed when publishing throws', async () => {
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const repo = {
      create: () => Promise.resolve(record()),
      markProcessed: vi.fn(),
      markFailed,
    } as unknown as WebhookDeliveryRepository;
    const bus = {
      publish: () => Promise.reject(new Error('bus down')),
    } as unknown as EventBus;
    const svc = new WebhookRouterService(repo, bus);

    await svc.ingest(input);
    expect(markFailed).toHaveBeenCalledWith('d1', 'bus down');
  });
});
