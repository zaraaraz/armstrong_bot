import type { PluginApi } from './plugin-api.interface';
import type { PluginScope } from './plugin.enums';

export interface PluginContext {
  readonly api: PluginApi;
  readonly scope: PluginScope;
  readonly guildId: string | null;
  readonly pluginName: string;
  readonly pluginVersion: string;
}
