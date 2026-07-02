import { beforeEach, describe, expect, it } from 'vitest';
import { VerifierRegistry } from './verifier.registry';
import { UnsupportedProviderError } from '../domain/errors/unsupported-provider.error';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import type {
  SignatureVerifier,
  VerificationContext,
} from './signature-verifier.interface';

/** Minimal fake verifier that records the provider it was resolved for. */
function fakeVerifier(provider: WebhookProvider): SignatureVerifier {
  return {
    provider,
    verify: (_ctx: VerificationContext): Promise<void> => Promise.resolve(),
  };
}

describe('VerifierRegistry', () => {
  let github: SignatureVerifier;
  let stripe: SignatureVerifier;

  beforeEach(() => {
    github = fakeVerifier(WebhookProvider.GitHub);
    stripe = fakeVerifier(WebhookProvider.Stripe);
  });

  it('resolves the verifier registered for each provider', () => {
    const registry = new VerifierRegistry([github, stripe]);
    expect(registry.resolve(WebhookProvider.GitHub)).toBe(github);
    expect(registry.resolve(WebhookProvider.Stripe)).toBe(stripe);
  });

  it('throws UnsupportedProviderError for an unregistered provider', () => {
    const registry = new VerifierRegistry([github]);
    expect(() => registry.resolve(WebhookProvider.Stripe)).toThrow(
      UnsupportedProviderError,
    );
  });

  it('names the missing provider in the thrown error message', () => {
    const registry = new VerifierRegistry([github]);
    expect(() => registry.resolve(WebhookProvider.FiveM)).toThrow(
      WebhookProvider.FiveM,
    );
  });

  it('keeps the first verifier when a provider is registered twice', () => {
    const firstGithub = fakeVerifier(WebhookProvider.GitHub);
    const secondGithub = fakeVerifier(WebhookProvider.GitHub);
    const registry = new VerifierRegistry([firstGithub, secondGithub]);
    expect(registry.resolve(WebhookProvider.GitHub)).toBe(firstGithub);
    expect(registry.resolve(WebhookProvider.GitHub)).not.toBe(secondGithub);
  });

  it('does not throw when duplicate providers are supplied', () => {
    expect(
      () =>
        new VerifierRegistry([
          fakeVerifier(WebhookProvider.GitHub),
          fakeVerifier(WebhookProvider.GitHub),
        ]),
    ).not.toThrow();
  });

  it('lists the registered provider set via providers()', () => {
    const registry = new VerifierRegistry([github, stripe]);
    const providers = registry.providers();
    expect(providers).toHaveLength(2);
    expect([...providers].sort()).toEqual(
      [WebhookProvider.GitHub, WebhookProvider.Stripe].sort(),
    );
  });

  it('deduplicates providers() when duplicates are supplied', () => {
    const registry = new VerifierRegistry([
      fakeVerifier(WebhookProvider.GitHub),
      fakeVerifier(WebhookProvider.GitHub),
      fakeVerifier(WebhookProvider.Stripe),
    ]);
    expect(registry.providers()).toHaveLength(2);
  });

  it('reports an empty provider set when no verifiers are registered', () => {
    const registry = new VerifierRegistry([]);
    expect(registry.providers()).toHaveLength(0);
    expect(() => registry.resolve(WebhookProvider.GitHub)).toThrow(
      UnsupportedProviderError,
    );
  });
});
