import { Logger } from '@nestjs/common';
import type { ZodTypeAny, infer as ZInfer } from 'zod';
import type {
  PluginApi,
  ScopedCache,
  ScopedLogger,
  PluginCommandRegistration,
} from '../contracts/plugin-api.interface';
import type { EventBus, EventHandler } from '../../events/event-bus';
import type { CacheService } from '../../../cache/cache.service';
import type {
  PermissionService,
  PermissionActor,
} from '../../permissions/application/permission.service';
import type { TranslationService } from '../../i18n/contracts/translation-service.contract';
import { toTranslationKey } from '../../i18n/contracts/translation-key';
import type { ServiceContractRegistry } from './service-contract.registry';
import type { EventEnvelope } from '../../events/envelope/event-envelope';
import type { EventName } from '../../events/registry/event-map';

export interface PluginApiOptions {
  pluginName: string;
  pluginVersion: string;
  guildId: string | null;
  grantedClaims: readonly string[];
  rawConfig: Record<string, unknown>;
  eventBus: EventBus;
  cache: CacheService;
  permissionService: PermissionService;
  translationService: TranslationService;
  contractRegistry: ServiceContractRegistry;
  commandRegistrar: (reg: PluginCommandRegistration) => void;
  commandDeregistrar: (name: string) => void;
  disposerStore: Array<() => void>;
}

export class PluginApiImpl implements PluginApi {
  private readonly nestLogger: Logger;
  readonly cache: ScopedCache;
  readonly logger: ScopedLogger;

  constructor(private readonly opts: PluginApiOptions) {
    this.nestLogger = new Logger(`Plugin:${opts.pluginName}`);
    this.cache = this.buildScopedCache();
    this.logger = this.buildScopedLogger();
  }

  registerCommand(reg: PluginCommandRegistration): void {
    this.opts.commandRegistrar(reg);
  }

  on<TPayload>(
    event: string,
    handler: (payload: TPayload) => Promise<void> | void,
  ): void {
    const handlerId = `plugin.${this.opts.pluginName}.${event}`;
    // Cast through unknown to bridge from EventEnvelope to plain payload for plugin authors
    const wrappedHandler = ((envelope: EventEnvelope<EventName>) =>
      handler(
        envelope.payload as unknown as TPayload,
      )) as unknown as EventHandler<EventName>;
    const sub = this.opts.eventBus.subscribe(
      event as EventName,
      wrappedHandler,
      { handlerId },
    );
    this.opts.disposerStore.push(() => sub.unsubscribe());
  }

  async emit<TPayload>(event: string, payload: TPayload): Promise<void> {
    const namespaced = `plugin.${this.opts.pluginName}.${event}` as EventName;
    await this.opts.eventBus.publish(
      namespaced,
      payload as Parameters<typeof this.opts.eventBus.publish>[1],
      { guildId: this.opts.guildId ?? undefined },
    );
  }

  getService<T>(token: string): T {
    return this.opts.contractRegistry.resolve<T>(
      token,
      this.opts.pluginName,
      this.opts.grantedClaims,
    );
  }

  t(key: string, vars?: Record<string, string | number>): string {
    const tKey = toTranslationKey(`${this.opts.pluginName}:${key}`);
    return this.opts.translationService.tSync(tKey, vars, 'pt');
  }

  async can(memberId: string, claim: string): Promise<boolean> {
    if (!this.opts.guildId) return false;
    const actor: PermissionActor = {
      userId: memberId,
      guildId: this.opts.guildId,
      discordRoleIds: [],
      isGuildOwner: false,
    };
    return this.opts.permissionService.can(actor, claim);
  }

  config<S extends ZodTypeAny>(schema: S): ZInfer<S> {
    return schema.parse(this.opts.rawConfig);
  }

  private buildScopedCache(): ScopedCache {
    const ns = `plugin:${this.opts.pluginName}:${this.opts.guildId ?? 'global'}`;
    const svc = this.opts.cache;
    return {
      get: <T>(key: string) => svc.get<T>(`${ns}:${key}`),
      set: <T>(key: string, value: T, ttlSeconds = 300) =>
        svc.set(`${ns}:${key}`, value, { ttlSeconds }),
      del: (key: string) => svc.delete(`${ns}:${key}`),
    };
  }

  private buildScopedLogger(): ScopedLogger {
    const log = this.nestLogger;
    const meta = { plugin: this.opts.pluginName, guildId: this.opts.guildId };
    return {
      debug: (msg, m) => log.debug(msg, { ...meta, ...m }),
      info: (msg, m) => log.log(msg, { ...meta, ...m }),
      warn: (msg, m) => log.warn(msg, { ...meta, ...m }),
      error: (msg, m) => log.error(msg, { ...meta, ...m }),
    };
  }
}
