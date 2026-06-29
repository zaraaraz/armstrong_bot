import { Inject, Injectable } from '@nestjs/common';
import type { ISecretProvider } from '../interfaces/security.interfaces';
import { SECRET_PROVIDER } from '../interfaces/security.interfaces';

/**
 * Single sanctioned entry point for reading secrets. No service reads
 * `process.env` for secrets directly — they go through here so the backing
 * provider (ENV today, Vault/AWS SM later) can be swapped centrally.
 */
@Injectable()
export class SecretService {
  constructor(
    @Inject(SECRET_PROVIDER) private readonly provider: ISecretProvider,
  ) {}

  get(name: string): Promise<string | undefined> {
    return this.provider.get(name);
  }

  require(name: string): Promise<string> {
    return this.provider.require(name);
  }
}
