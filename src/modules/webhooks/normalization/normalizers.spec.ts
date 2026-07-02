import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CustomNormalizer } from './custom.normalizer';
import { FivemNormalizer } from './fivem.normalizer';
import { GithubNormalizer } from './github.normalizer';
import { StripeNormalizer } from './stripe.normalizer';
import type { NormalizationContext } from './payload-normalizer.interface';
import { WebhookProvider } from '../domain/webhook-provider.enum';

const FIXTURES_DIR = join(__dirname, '__fixtures__');

/** Loads a fixture JSON file as a Buffer (its real on-disk wire bytes). */
function fixtureBuffer(name: string): Buffer {
  return Buffer.from(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8'));
}

/** Builds a NormalizationContext around a raw body + headers. */
function ctx(
  rawBody: Buffer,
  headers: Record<string, string | undefined> = {},
  overrides: Partial<Omit<NormalizationContext, 'rawBody' | 'headers'>> = {},
): NormalizationContext {
  return {
    rawBody,
    headers,
    guildId: overrides.guildId ?? 'guild-123',
    internalDeliveryId: overrides.internalDeliveryId ?? 'internal-abc',
  };
}

const GARBAGE = Buffer.from('not json');

describe('GithubNormalizer', () => {
  let normalizer: GithubNormalizer;

  beforeEach(() => {
    normalizer = new GithubNormalizer();
  });

  it('declares the github provider', () => {
    expect(normalizer.provider).toBe(WebhookProvider.GitHub);
  });

  it('normalizes a push payload into a github.push event', async () => {
    const event = await normalizer.normalize(
      ctx(fixtureBuffer('github-push'), {
        'x-github-event': 'push',
        'x-github-delivery': 'gh-delivery-1',
      }),
    );

    expect(event).not.toBeNull();
    if (event === null) throw new Error('expected a non-null event');
    expect(event.type).toBe('github.push');
    expect(event.provider).toBe(WebhookProvider.GitHub);
    expect(event.deliveryId).toBe('gh-delivery-1');
    expect(event.internalDeliveryId).toBe('internal-abc');
    expect(event.guildId).toBe('guild-123');
    expect(event.data).toMatchObject({
      repo: 'ghost-org/armstrong-bot',
      ref: 'refs/heads/main',
      before: '9d8f3a1c0b7e5f4a2d1c0b9a8f7e6d5c4b3a2109',
      after: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4',
      commitCount: 2,
      pusher: 'octocat',
    });
  });

  it('passes the internalDeliveryId through unchanged', async () => {
    const event = await normalizer.normalize(
      ctx(
        fixtureBuffer('github-push'),
        { 'x-github-event': 'push' },
        { internalDeliveryId: 'trace-xyz' },
      ),
    );
    expect(event).not.toBeNull();
    expect(event?.internalDeliveryId).toBe('trace-xyz');
  });

  it('falls back to a null deliveryId when the delivery header is absent', async () => {
    const event = await normalizer.normalize(
      ctx(fixtureBuffer('github-push'), { 'x-github-event': 'push' }),
    );
    expect(event?.deliveryId).toBeNull();
  });

  it('normalizes a pull_request payload into a github.pull_request event', async () => {
    const event = await normalizer.normalize(
      ctx(fixtureBuffer('github-pull_request'), {
        'x-github-event': 'pull_request',
      }),
    );

    expect(event).not.toBeNull();
    if (event === null) throw new Error('expected a non-null event');
    expect(event.type).toBe('github.pull_request');
    expect(event.data).toMatchObject({
      action: 'opened',
      number: 42,
      title: 'Add PayloadNormalizer strategies',
      repo: 'ghost-org/armstrong-bot',
    });
  });

  it('ignores an unknown event header (e.g. star) by resolving null', async () => {
    const event = await normalizer.normalize(
      ctx(fixtureBuffer('github-push'), { 'x-github-event': 'star' }),
    );
    expect(event).toBeNull();
  });

  it('ignores a ping event by resolving null', async () => {
    const event = await normalizer.normalize(
      ctx(fixtureBuffer('github-push'), { 'x-github-event': 'ping' }),
    );
    expect(event).toBeNull();
  });

  it('resolves null when no event header is present', async () => {
    const event = await normalizer.normalize(ctx(fixtureBuffer('github-push')));
    expect(event).toBeNull();
  });

  it('resolves null (does not throw) on a garbage body', async () => {
    await expect(
      normalizer.normalize(ctx(GARBAGE, { 'x-github-event': 'push' })),
    ).resolves.toBeNull();
  });
});

describe('StripeNormalizer', () => {
  let normalizer: StripeNormalizer;

  beforeEach(() => {
    normalizer = new StripeNormalizer();
  });

  it('declares the stripe provider', () => {
    expect(normalizer.provider).toBe(WebhookProvider.Stripe);
  });

  it('normalizes payment_intent.succeeded into a stripe.payment.succeeded event', async () => {
    const event = await normalizer.normalize(
      ctx(fixtureBuffer('stripe-payment_intent')),
    );

    expect(event).not.toBeNull();
    if (event === null) throw new Error('expected a non-null event');
    expect(event.type).toBe('stripe.payment.succeeded');
    expect(event.provider).toBe(WebhookProvider.Stripe);
    // deliveryId is the top-level Stripe event id.
    expect(event.deliveryId).toBe('evt_1PqR2sX3yZaBcDeFgHiJkLmN');
    expect(event.internalDeliveryId).toBe('internal-abc');
    expect(event.data).toMatchObject({
      objectId: 'pi_3PqR2sX3yZaBcDeF0GhIjKlM',
      amount: 2500,
      currency: 'eur',
    });
  });

  it('derives occurredAt from the created epoch (seconds)', async () => {
    const event = await normalizer.normalize(
      ctx(fixtureBuffer('stripe-payment_intent')),
    );
    expect(event?.occurredAt.getTime()).toBe(1751414400 * 1000);
  });

  it('ignores an unknown stripe type by resolving null', async () => {
    const body = Buffer.from(
      JSON.stringify({ id: 'evt_x', type: 'charge.refunded', created: 1 }),
    );
    const event = await normalizer.normalize(ctx(body));
    expect(event).toBeNull();
  });

  it('resolves null when the type field is missing', async () => {
    const body = Buffer.from(JSON.stringify({ id: 'evt_x', created: 1 }));
    const event = await normalizer.normalize(ctx(body));
    expect(event).toBeNull();
  });

  it('resolves null (does not throw) on a garbage body', async () => {
    await expect(normalizer.normalize(ctx(GARBAGE))).resolves.toBeNull();
  });
});

describe('FivemNormalizer', () => {
  let normalizer: FivemNormalizer;

  beforeEach(() => {
    normalizer = new FivemNormalizer();
  });

  it('declares the fivem provider', () => {
    expect(normalizer.provider).toBe(WebhookProvider.FiveM);
  });

  it('normalizes a player-join payload into a fivem.player.join event', async () => {
    const event = await normalizer.normalize(
      ctx(fixtureBuffer('fivem-player-join')),
    );

    expect(event).not.toBeNull();
    if (event === null) throw new Error('expected a non-null event');
    expect(event.type).toBe('fivem.player.join');
    expect(event.provider).toBe(WebhookProvider.FiveM);
    // deliveryId comes from body.id.
    expect(event.deliveryId).toBe('d4f9c2a1-6b3e-4c8d-9f1a-2e7b5c6d8a90');
    expect(event.data).toMatchObject({
      playerId: 'steam:110000112345678',
      name: 'GhostRider',
    });
  });

  it('falls back to the x-delivery-id header when body.id is absent', async () => {
    const body = Buffer.from(
      JSON.stringify({ event: 'player.join', player: { id: 'p1', name: 'n' } }),
    );
    const event = await normalizer.normalize(
      ctx(body, { 'x-delivery-id': 'hdr-delivery' }),
    );
    expect(event?.deliveryId).toBe('hdr-delivery');
  });

  it('ignores an unknown fivem event by resolving null', async () => {
    const body = Buffer.from(JSON.stringify({ event: 'player.chat' }));
    const event = await normalizer.normalize(ctx(body));
    expect(event).toBeNull();
  });

  it('resolves null when the event field is missing', async () => {
    const body = Buffer.from(JSON.stringify({ player: { id: 'p1' } }));
    const event = await normalizer.normalize(ctx(body));
    expect(event).toBeNull();
  });

  it('resolves null (does not throw) on a garbage body', async () => {
    await expect(normalizer.normalize(ctx(GARBAGE))).resolves.toBeNull();
  });
});

describe('CustomNormalizer', () => {
  let normalizer: CustomNormalizer;

  beforeEach(() => {
    normalizer = new CustomNormalizer();
  });

  it('declares the custom provider', () => {
    expect(normalizer.provider).toBe(WebhookProvider.Custom);
  });

  it('normalizes a custom-event payload into a custom.<type> event with data present', async () => {
    const event = await normalizer.normalize(
      ctx(fixtureBuffer('custom-event')),
    );

    expect(event).not.toBeNull();
    if (event === null) throw new Error('expected a non-null event');
    expect(event.type).toMatch(/^custom\./);
    // "Order.Created" is lowercased & sanitized.
    expect(event.type).toBe('custom.order.created');
    expect(event.provider).toBe(WebhookProvider.Custom);
    expect(event.deliveryId).toBe('custom-01J9ZK3ABCDEF1234567890');
    expect(event.data).toMatchObject({
      orderId: 'ord_98765',
      total: 4999,
      currency: 'eur',
    });
  });

  it('parses occurredAt from a body.timestamp string', async () => {
    const event = await normalizer.normalize(
      ctx(fixtureBuffer('custom-event')),
    );
    expect(event?.occurredAt.toISOString()).toBe('2026-07-02T09:20:00.000Z');
  });

  it('falls back to the whole body as data when body.data is absent', async () => {
    const body = Buffer.from(
      JSON.stringify({ id: 'c1', type: 'ping', foo: 'bar' }),
    );
    const event = await normalizer.normalize(ctx(body));
    expect(event?.type).toBe('custom.ping');
    expect(event?.data).toMatchObject({ id: 'c1', type: 'ping', foo: 'bar' });
  });

  it('resolves null (does not throw) on a garbage body', async () => {
    await expect(normalizer.normalize(ctx(GARBAGE))).resolves.toBeNull();
  });
});
