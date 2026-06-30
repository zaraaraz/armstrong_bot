import { Inject, Injectable } from '@nestjs/common';
import { EventBus } from '../../events/event-bus';
import { CacheService } from '../../../cache/cache.service';
import { PermissionService } from '../../permissions/application/permission.service';
import { TranslationService } from '../../i18n/contracts/translation-service.contract';
import { ServiceContractRegistry } from './service-contract.registry';
import { PluginApiImpl } from './plugin-api';
import type {
  PluginApi,
  PluginCommandRegistration,
} from '../contracts/plugin-api.interface';

@Injectable()
export class PluginApiFactory {
  constructor(
    @Inject(EventBus) private readonly eventBus: EventBus,
    private readonly cache: CacheService,
    private readonly permissionService: PermissionService,
    @Inject(TranslationService)
    private readonly translationService: TranslationService,
    private readonly contractRegistry: ServiceContractRegistry,
  ) {}

  build(opts: {
    pluginName: string;
    pluginVersion: string;
    guildId: string | null;
    grantedClaims: readonly string[];
    rawConfig: Record<string, unknown>;
    commandRegistrar: (reg: PluginCommandRegistration) => void;
    commandDeregistrar: (name: string) => void;
    disposerStore: Array<() => void>;
  }): PluginApi {
    return new PluginApiImpl({
      ...opts,
      eventBus: this.eventBus,
      cache: this.cache,
      permissionService: this.permissionService,
      translationService: this.translationService,
      contractRegistry: this.contractRegistry,
    });
  }
}
