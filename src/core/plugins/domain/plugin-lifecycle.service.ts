import { Injectable, Logger } from '@nestjs/common';
import { PluginStatus } from '../contracts/plugin.enums';
import { PluginError, PluginErrorCode } from '../errors/plugin.errors';
import type { LoadedPluginEntry } from './plugin-registry';
import type { PluginContext } from '../contracts/plugin-context.interface';

type Phase = 'install' | 'enable' | 'disable' | 'update' | 'remove';

const ALLOWED_TRANSITIONS: Record<PluginStatus, readonly PluginStatus[]> = {
  [PluginStatus.Installed]: [
    PluginStatus.Enabled,
    PluginStatus.Removed,
    PluginStatus.Errored,
  ],
  [PluginStatus.Enabled]: [
    PluginStatus.Disabled,
    PluginStatus.Updating,
    PluginStatus.Errored,
  ],
  [PluginStatus.Disabled]: [
    PluginStatus.Enabled,
    PluginStatus.Removed,
    PluginStatus.Errored,
  ],
  [PluginStatus.Errored]: [PluginStatus.Disabled, PluginStatus.Removed],
  [PluginStatus.Updating]: [PluginStatus.Installed, PluginStatus.Errored],
  [PluginStatus.Removed]: [],
};

@Injectable()
export class PluginLifecycleService {
  private readonly logger = new Logger(PluginLifecycleService.name);

  assertTransition(
    current: PluginStatus,
    next: PluginStatus,
    pluginName: string,
  ): void {
    if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
      throw new PluginError(
        PluginErrorCode.InvalidTransition,
        `Cannot transition "${pluginName}" from ${current} to ${next}`,
        pluginName,
      );
    }
  }

  async runHook(
    entry: LoadedPluginEntry,
    phase: Phase,
    ctx: PluginContext,
    timeoutMs: number,
    fromVersion?: string,
  ): Promise<void> {
    const { plugin } = entry;
    const name = plugin.manifest.name;

    const hookFn = (() => {
      switch (phase) {
        case 'install':
          return plugin.onInstall?.bind(plugin);
        case 'enable':
          return plugin.onEnable.bind(plugin);
        case 'disable':
          return plugin.onDisable.bind(plugin);
        case 'update':
          return plugin.onUpdate?.bind(plugin);
        case 'remove':
          return plugin.onRemove?.bind(plugin);
      }
    })();

    if (!hookFn) return;

    const hookPromise =
      phase === 'update' && fromVersion
        ? (plugin.onUpdate as NonNullable<typeof plugin.onUpdate>)(
            ctx,
            fromVersion,
          )
        : (hookFn as (ctx: PluginContext) => Promise<void>)(ctx);

    const timeout = new Promise<never>((_, reject) => {
      const t = setTimeout(
        () =>
          reject(
            new PluginError(
              PluginErrorCode.HookTimeout,
              `Hook "${phase}" timed out for "${name}"`,
              name,
            ),
          ),
        timeoutMs,
      );
      t.unref();
    });

    try {
      await Promise.race([hookPromise, timeout]);
      this.logger.log(`[plugin.lifecycle] ${name} — ${phase} OK`);
    } catch (err) {
      this.logger.error(
        `[plugin.lifecycle] ${name} — ${phase} FAILED: ${String(err)}`,
      );
      throw err instanceof PluginError
        ? err
        : new PluginError(
            PluginErrorCode.HookFailed,
            `Hook "${phase}" threw in "${name}": ${String(err)}`,
            name,
            err,
          );
    }
  }

  drainDisposers(entry: LoadedPluginEntry): void {
    for (const disposer of entry.disposers) {
      try {
        disposer();
      } catch {
        // best-effort
      }
    }
    entry.disposers.length = 0;
  }
}
