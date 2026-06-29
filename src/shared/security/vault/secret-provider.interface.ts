import type { ISecretProvider } from '../interfaces/security.interfaces';

/** A pluggable backend that resolves named secrets (ENV, Vault, AWS SM, …). */
export type SecretProvider = ISecretProvider;
