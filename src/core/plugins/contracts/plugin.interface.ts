import type { PluginManifest } from './plugin-manifest.interface';
import type { PluginHooks } from './lifecycle-hooks.interface';

export interface Plugin<TConfig = unknown> extends PluginHooks {
  readonly manifest: PluginManifest<TConfig>;
}

export type PluginFactory = () => Plugin | Promise<Plugin>;
