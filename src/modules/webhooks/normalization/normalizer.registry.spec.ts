import { beforeEach, describe, expect, it } from 'vitest';
import { CustomNormalizer } from './custom.normalizer';
import { FivemNormalizer } from './fivem.normalizer';
import { GithubNormalizer } from './github.normalizer';
import { NormalizerRegistry } from './normalizer.registry';
import { StripeNormalizer } from './stripe.normalizer';
import type { PayloadNormalizer } from './payload-normalizer.interface';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import { UnsupportedProviderError } from '../domain/errors/unsupported-provider.error';

describe('NormalizerRegistry', () => {
  let github: GithubNormalizer;
  let stripe: StripeNormalizer;
  let fivem: FivemNormalizer;
  let custom: CustomNormalizer;
  let registry: NormalizerRegistry;

  beforeEach(() => {
    github = new GithubNormalizer();
    stripe = new StripeNormalizer();
    fivem = new FivemNormalizer();
    custom = new CustomNormalizer();
    registry = new NormalizerRegistry([github, stripe, fivem, custom]);
  });

  it('resolves the github normalizer for WebhookProvider.GitHub', () => {
    expect(registry.resolve(WebhookProvider.GitHub)).toBe(github);
  });

  it('resolves each provider to its own registered normalizer', () => {
    expect(registry.resolve(WebhookProvider.Stripe)).toBe(stripe);
    expect(registry.resolve(WebhookProvider.FiveM)).toBe(fivem);
    expect(registry.resolve(WebhookProvider.Custom)).toBe(custom);
  });

  it('throws UnsupportedProviderError for a provider with no registered normalizer', () => {
    const onlyGithub = new NormalizerRegistry([github]);
    expect(() => onlyGithub.resolve(WebhookProvider.Stripe)).toThrow(
      UnsupportedProviderError,
    );
  });

  it('lists all four registered providers', () => {
    const providers = registry.providers();
    expect(providers).toHaveLength(4);
    expect([...providers].sort()).toEqual(
      [
        WebhookProvider.GitHub,
        WebhookProvider.Stripe,
        WebhookProvider.FiveM,
        WebhookProvider.Custom,
      ].sort(),
    );
  });

  it('keeps the first normalizer when a provider is registered twice', () => {
    const first = new GithubNormalizer();
    const second = new GithubNormalizer();
    const dupRegistry = new NormalizerRegistry([
      first,
      second,
    ] as readonly PayloadNormalizer[]);
    expect(dupRegistry.resolve(WebhookProvider.GitHub)).toBe(first);
    expect(dupRegistry.providers()).toHaveLength(1);
  });

  it('lists no providers when constructed empty', () => {
    const empty = new NormalizerRegistry([]);
    expect(empty.providers()).toHaveLength(0);
    expect(() => empty.resolve(WebhookProvider.GitHub)).toThrow(
      UnsupportedProviderError,
    );
  });
});
