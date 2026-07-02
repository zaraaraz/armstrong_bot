/** Thrown when no verifier/normalizer strategy is registered for a provider. */
export class UnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(`no strategy registered for webhook provider: ${provider}`);
    this.name = 'UnsupportedProviderError';
  }
}
