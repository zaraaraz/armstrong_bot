import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ISecretProvider } from '../interfaces/security.interfaces';

/** Default secret provider: resolves secrets from validated environment config. */
@Injectable()
export class EnvSecretProvider implements ISecretProvider {
  constructor(private readonly config: ConfigService) {}

  get(name: string): Promise<string | undefined> {
    return Promise.resolve(this.config.get<string>(name));
  }

  async require(name: string): Promise<string> {
    const value = await this.get(name);
    if (value === undefined || value === '') {
      throw new Error(`Required secret "${name}" is not configured.`);
    }
    return value;
  }
}
