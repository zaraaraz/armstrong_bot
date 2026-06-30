import { Global, Module } from '@nestjs/common';
import { PluginApplicationService } from './application/plugin.application-service';
import { PluginRepository } from './infrastructure/plugin.repository';
import { PluginRegistry } from './domain/plugin-registry';
import { PluginLoaderService } from './domain/plugin-loader.service';
import { PluginDependencyResolver } from './domain/plugin-dependency.resolver';
import { PluginLifecycleService } from './domain/plugin-lifecycle.service';
import { PluginSandbox } from './domain/plugin-sandbox';
import { PluginApiFactory } from './api/plugin-api.factory';
import { ServiceContractRegistry } from './api/service-contract.registry';
import { PluginsController } from './controllers/plugins.controller';

@Global()
@Module({
  controllers: [PluginsController],
  providers: [
    PluginApplicationService,
    PluginRepository,
    PluginRegistry,
    PluginLoaderService,
    PluginDependencyResolver,
    PluginLifecycleService,
    PluginSandbox,
    PluginApiFactory,
    ServiceContractRegistry,
  ],
  exports: [PluginApplicationService, ServiceContractRegistry, PluginRegistry],
})
export class PluginsModule {}
