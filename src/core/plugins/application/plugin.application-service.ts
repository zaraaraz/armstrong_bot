import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBus } from '../../events/event-bus';
import { PluginRepository } from '../infrastructure/plugin.repository';
import { PluginRegistry } from '../domain/plugin-registry';
import { PluginLoaderService } from '../domain/plugin-loader.service';
import { PluginDependencyResolver } from '../domain/plugin-dependency.resolver';
import { PluginLifecycleService } from '../domain/plugin-lifecycle.service';
import { PluginApiFactory } from '../api/plugin-api.factory';
import { PluginStatus } from '../contracts/plugin.enums';
import { PluginError, PluginErrorCode } from '../errors/plugin.errors';
import { PLUGIN_EVENTS } from '../events/plugin.events';
import { PluginSystemConfigSchema } from '../config/plugin.config';
import type {
  ListPluginsFilter,
  PluginRecord,
} from '../infrastructure/plugin.repository';
import type { LoadedPluginEntry } from '../domain/plugin-registry';
import type { PluginContext } from '../contracts/plugin-context.interface';
import type { PluginCommandRegistration } from '../contracts/plugin-api.interface';
import type {
  UpdatePluginStateDto,
  UpdatePluginConfigDto,
} from './dto/install-plugin.dto';
import type { InstallPluginDto } from './dto/install-plugin.dto';
import type { EventEnvelope } from '../../events/envelope/event-envelope';
import type { EventName } from '../../events/registry/event-map';
import * as path from 'path';

@Injectable()
export class PluginApplicationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginApplicationService.name);
  private readonly sdkVersion: string;
  private readonly hookTimeoutMs: number;

  constructor(
    private readonly configService: ConfigService,
    @Inject(EventBus) private readonly eventBus: EventBus,
    private readonly repo: PluginRepository,
    private readonly registry: PluginRegistry,
    private readonly loader: PluginLoaderService,
    private readonly resolver: PluginDependencyResolver,
    private readonly lifecycle: PluginLifecycleService,
    private readonly apiFactory: PluginApiFactory,
  ) {
    const cfg = PluginSystemConfigSchema.parse({
      sdkVersion: this.configService.get<string>('PLUGIN_SDK_VERSION'),
      hookTimeoutMs: this.configService.get<number>('PLUGIN_HOOK_TIMEOUT_MS'),
      pluginsDir: this.configService.get<string>('PLUGIN_DIR'),
    });
    this.sdkVersion = cfg.sdkVersion;
    this.hookTimeoutMs = cfg.hookTimeoutMs;
  }

  onModuleInit(): void {
    this.eventBus.subscribe(
      'core.shutdown' as EventName,
      async () => {
        await this.disableAll();
      },
      { handlerId: 'plugin-system.core.shutdown' },
    );
    this.eventBus.subscribe(
      'guild.removed' as EventName,
      async (envelope: EventEnvelope<EventName>) => {
        const payload = envelope.payload as unknown as { guildId: string };
        await this.disableForGuild(payload.guildId);
      },
      { handlerId: 'plugin-system.guild.removed' },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.disableAll();
  }

  async installPlugin(
    dto: InstallPluginDto,
    actorId: string,
  ): Promise<PluginRecord> {
    const existing = await this.repo.findByName(
      path.basename(dto.source, path.extname(dto.source)),
    );
    if (existing) {
      throw new PluginError(
        PluginErrorCode.AlreadyInstalled,
        `Plugin "${existing.name}" is already installed`,
        existing.name,
      );
    }

    const plugin = await this.loader.load(dto.source);
    const { manifest } = plugin;

    this.resolver.validateSdkRange(manifest, this.sdkVersion);
    this.resolver.validateDependencies(manifest);

    const record = await this.repo.create({
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      author: manifest.author,
      scope: manifest.scope,
      sdkRange: manifest.sdkRange,
      checksum: manifest.checksum,
      manifest,
    });

    await this.repo.recordVersionHistory(
      record.id,
      null,
      manifest.version,
      actorId,
    );

    const entry: LoadedPluginEntry = {
      plugin,
      status: PluginStatus.Installed,
      enabledGuilds: new Set(),
      registeredCommandIds: [],
      disposers: [],
    };
    this.registry.set(manifest.name, entry);

    const ctx = this.buildContext(entry, null);
    if (plugin.onInstall) {
      try {
        await this.lifecycle.runHook(entry, 'install', ctx, this.hookTimeoutMs);
      } catch (err) {
        await this.markErrored(record.id, manifest.name, err);
        await this.emitErrored(manifest.name, 'install', null, err);
        throw err;
      }
    }

    await this.eventBus.publish(PLUGIN_EVENTS.Installed, {
      name: manifest.name,
      version: manifest.version,
      actorId,
      at: new Date().toISOString(),
    });

    this.logger.log(
      `[plugin.lifecycle] installed: ${manifest.name}@${manifest.version}`,
    );
    return record;
  }

  async enablePlugin(name: string, dto: UpdatePluginStateDto): Promise<void> {
    const record = await this.requireRecord(name);
    const entry = this.requireEntry(name);

    this.lifecycle.assertTransition(entry.status, PluginStatus.Enabled, name);

    const ctx = this.buildContext(entry, dto.guildId);
    try {
      await this.lifecycle.runHook(entry, 'enable', ctx, this.hookTimeoutMs);
    } catch (err) {
      await this.markErrored(record.id, name, err);
      await this.emitErrored(name, 'enable', dto.guildId, err);
      throw err;
    }

    if (dto.guildId) entry.enabledGuilds.add(dto.guildId);
    entry.status = PluginStatus.Enabled;

    await this.repo.updateStatus(record.id, PluginStatus.Enabled);
    await this.repo.setEnablement(record.id, dto.guildId, true, dto.actorId);

    await this.eventBus.publish(PLUGIN_EVENTS.Enabled, {
      name,
      version: record.version,
      guildId: dto.guildId,
      actorId: dto.actorId,
      at: new Date().toISOString(),
    });
    this.logger.log(
      `[plugin.lifecycle] enabled: ${name} guild=${dto.guildId ?? 'global'}`,
    );
  }

  async disablePlugin(name: string, dto: UpdatePluginStateDto): Promise<void> {
    const record = await this.requireRecord(name);
    const entry = this.requireEntry(name);

    this.lifecycle.assertTransition(entry.status, PluginStatus.Disabled, name);

    const ctx = this.buildContext(entry, dto.guildId);
    try {
      await this.lifecycle.runHook(entry, 'disable', ctx, this.hookTimeoutMs);
    } catch (err) {
      await this.markErrored(record.id, name, err);
      await this.emitErrored(name, 'disable', dto.guildId, err);
      throw err;
    }

    this.lifecycle.drainDisposers(entry);
    if (dto.guildId) entry.enabledGuilds.delete(dto.guildId);
    entry.status = PluginStatus.Disabled;

    await this.repo.updateStatus(record.id, PluginStatus.Disabled);
    await this.repo.setEnablement(record.id, dto.guildId, false, dto.actorId);

    await this.eventBus.publish(PLUGIN_EVENTS.Disabled, {
      name,
      version: record.version,
      guildId: dto.guildId,
      actorId: dto.actorId,
      at: new Date().toISOString(),
    });
    this.logger.log(
      `[plugin.lifecycle] disabled: ${name} guild=${dto.guildId ?? 'global'}`,
    );
  }

  async updatePlugin(
    name: string,
    source: string,
    actorId: string,
  ): Promise<void> {
    const record = await this.requireRecord(name);
    const entry = this.requireEntry(name);

    this.lifecycle.assertTransition(entry.status, PluginStatus.Updating, name);
    entry.status = PluginStatus.Updating;
    await this.repo.updateStatus(record.id, PluginStatus.Updating);

    const newPlugin = await this.loader.load(source);
    this.resolver.validateSdkRange(newPlugin.manifest, this.sdkVersion);

    const fromVersion = record.version;
    const ctx = this.buildContext(entry, null);

    try {
      if (newPlugin.onUpdate) {
        const tempEntry: LoadedPluginEntry = { ...entry, plugin: newPlugin };
        await this.lifecycle.runHook(
          tempEntry,
          'update',
          ctx,
          this.hookTimeoutMs,
          fromVersion,
        );
      }
    } catch (err) {
      entry.status = PluginStatus.Errored;
      await this.repo.updateStatus(record.id, PluginStatus.Errored);
      await this.emitErrored(name, 'update', null, err);
      throw err;
    }

    const updatedEntry = entry as { plugin: typeof newPlugin };
    updatedEntry.plugin = newPlugin;
    entry.status = PluginStatus.Installed;

    await this.repo.updateVersion(
      record.id,
      newPlugin.manifest.version,
      actorId,
      fromVersion,
    );

    await this.eventBus.publish(PLUGIN_EVENTS.Updated, {
      name,
      fromVersion,
      toVersion: newPlugin.manifest.version,
      actorId,
      at: new Date().toISOString(),
    });
    this.logger.log(
      `[plugin.lifecycle] updated: ${name} ${fromVersion} -> ${newPlugin.manifest.version}`,
    );
  }

  async removePlugin(name: string, actorId: string): Promise<void> {
    const record = await this.requireRecord(name);
    const entry = this.requireEntry(name);

    this.lifecycle.assertTransition(entry.status, PluginStatus.Removed, name);

    const ctx = this.buildContext(entry, null);
    if (entry.plugin.onRemove) {
      try {
        await this.lifecycle.runHook(entry, 'remove', ctx, this.hookTimeoutMs);
      } catch (err) {
        this.logger.warn(
          `[plugin.lifecycle] remove hook failed for ${name}, proceeding: ${String(err)}`,
        );
      }
    }

    this.lifecycle.drainDisposers(entry);
    this.registry.remove(name);
    await this.repo.softDelete(record.id);

    await this.eventBus.publish(PLUGIN_EVENTS.Removed, {
      name,
      actorId,
      at: new Date().toISOString(),
    });
    this.logger.log(`[plugin.lifecycle] removed: ${name}`);
  }

  async updateConfig(name: string, dto: UpdatePluginConfigDto): Promise<void> {
    const record = await this.requireRecord(name);
    const entry = this.requireEntry(name);

    const result = entry.plugin.manifest.configSchema.safeParse(dto.values);
    if (!result.success) {
      throw new PluginError(
        PluginErrorCode.ConfigInvalid,
        `Invalid config for plugin "${name}": ${result.error.message}`,
        name,
      );
    }

    await this.repo.upsertConfig(record.id, dto.guildId, dto.values);
  }

  async listPlugins(
    filter: ListPluginsFilter,
  ): Promise<{ items: PluginRecord[]; total: number }> {
    return this.repo.list(filter);
  }

  async getPlugin(name: string): Promise<PluginRecord> {
    return this.requireRecord(name);
  }

  private async disableAll(): Promise<void> {
    for (const entry of this.registry.all()) {
      if (entry.status === PluginStatus.Enabled) {
        const ctx = this.buildContext(entry, null);
        try {
          await this.lifecycle.runHook(
            entry,
            'disable',
            ctx,
            this.hookTimeoutMs,
          );
          this.lifecycle.drainDisposers(entry);
          entry.status = PluginStatus.Disabled;
        } catch {
          entry.status = PluginStatus.Errored;
        }
      }
    }
  }

  private async disableForGuild(guildId: string): Promise<void> {
    for (const entry of this.registry.all()) {
      if (entry.enabledGuilds.has(guildId)) {
        const ctx = this.buildContext(entry, guildId);
        try {
          await this.lifecycle.runHook(
            entry,
            'disable',
            ctx,
            this.hookTimeoutMs,
          );
          this.lifecycle.drainDisposers(entry);
          entry.enabledGuilds.delete(guildId);
        } catch {
          // best-effort
        }
      }
    }
  }

  private buildContext(
    entry: LoadedPluginEntry,
    guildId: string | null,
  ): PluginContext {
    const api = this.apiFactory.build({
      pluginName: entry.plugin.manifest.name,
      pluginVersion: entry.plugin.manifest.version,
      guildId,
      grantedClaims: entry.plugin.manifest.services.map(
        (s) => `plugins.service.${s}`,
      ),
      rawConfig: {},
      commandRegistrar: (reg: PluginCommandRegistration) => {
        entry.registeredCommandIds.push((reg.builder as { name: string }).name);
      },
      commandDeregistrar: (name: string) => {
        const idx = entry.registeredCommandIds.indexOf(name);
        if (idx >= 0) entry.registeredCommandIds.splice(idx, 1);
      },
      disposerStore: entry.disposers,
    });

    return {
      api,
      scope: entry.plugin.manifest.scope,
      guildId,
      pluginName: entry.plugin.manifest.name,
      pluginVersion: entry.plugin.manifest.version,
    };
  }

  private async requireRecord(name: string): Promise<PluginRecord> {
    const record = await this.repo.findByName(name);
    if (!record) {
      throw new PluginError(
        PluginErrorCode.NotFound,
        `Plugin "${name}" not found`,
        name,
      );
    }
    return record;
  }

  private requireEntry(name: string): LoadedPluginEntry {
    const entry = this.registry.get(name);
    if (!entry) {
      throw new PluginError(
        PluginErrorCode.NotFound,
        `Plugin "${name}" is not loaded in registry`,
        name,
      );
    }
    return entry;
  }

  private async markErrored(
    id: string,
    name: string,
    err: unknown,
  ): Promise<void> {
    const entry = this.registry.get(name);
    if (entry) entry.status = PluginStatus.Errored;
    await this.repo.updateStatus(id, PluginStatus.Errored);
    this.logger.error(
      `[plugin.lifecycle] ${name} marked ERRORED: ${String(err)}`,
    );
  }

  private async emitErrored(
    name: string,
    phase:
      | 'load'
      | 'install'
      | 'enable'
      | 'disable'
      | 'update'
      | 'remove'
      | 'runtime',
    guildId: string | null,
    err: unknown,
  ): Promise<void> {
    await this.eventBus.publish(PLUGIN_EVENTS.Errored, {
      name,
      phase,
      guildId,
      message: String(err),
      at: new Date().toISOString(),
    });
  }
}
