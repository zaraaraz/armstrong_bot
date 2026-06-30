import type {
  PluginInstalledPayload,
  PluginScopePayload,
  PluginUpdatedPayload,
  PluginRemovedPayload,
  PluginErroredPayload,
} from '../../../plugins/events/plugin.events';

export interface PluginEventPayloads {
  'plugin.installed': PluginInstalledPayload;
  'plugin.enabled': PluginScopePayload;
  'plugin.disabled': PluginScopePayload;
  'plugin.updated': PluginUpdatedPayload;
  'plugin.removed': PluginRemovedPayload;
  'plugin.errored': PluginErroredPayload;
}
