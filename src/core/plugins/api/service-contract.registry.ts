import { Injectable, Logger } from '@nestjs/common';
import { PluginError, PluginErrorCode } from '../errors/plugin.errors';

@Injectable()
export class ServiceContractRegistry {
  private readonly logger = new Logger(ServiceContractRegistry.name);
  private readonly contracts = new Map<string, unknown>();

  register<T>(token: string, impl: T): void {
    this.contracts.set(token, impl);
    this.logger.debug(`Registered service contract: ${token}`);
  }

  resolve<T>(
    token: string,
    pluginName: string,
    grantedClaims: readonly string[],
  ): T {
    const required = `plugins.service.${token}`;
    if (
      !grantedClaims.includes(required) &&
      !grantedClaims.includes('plugins.*')
    ) {
      this.logger.warn(
        `[plugin.security] "${pluginName}" denied access to service "${token}"`,
      );
      throw new PluginError(
        PluginErrorCode.ServiceAccessDenied,
        `Plugin "${pluginName}" lacks claim "${required}" to access service "${token}"`,
        pluginName,
      );
    }

    const impl = this.contracts.get(token);
    if (!impl) {
      throw new PluginError(
        PluginErrorCode.ServiceAccessDenied,
        `Service contract "${token}" is not registered`,
        pluginName,
      );
    }

    return impl as T;
  }
}
