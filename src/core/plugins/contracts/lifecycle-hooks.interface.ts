import type { PluginContext } from './plugin-context.interface';

export interface PluginHooks {
  onInstall?(ctx: PluginContext): Promise<void>;
  onEnable(ctx: PluginContext): Promise<void>;
  onDisable(ctx: PluginContext): Promise<void>;
  onUpdate?(ctx: PluginContext, fromVersion: string): Promise<void>;
  onRemove?(ctx: PluginContext): Promise<void>;
}
