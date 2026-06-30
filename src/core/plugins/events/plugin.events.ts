export const PLUGIN_EVENTS = {
  Installed: 'plugin.installed',
  Enabled: 'plugin.enabled',
  Disabled: 'plugin.disabled',
  Updated: 'plugin.updated',
  Removed: 'plugin.removed',
  Errored: 'plugin.errored',
} as const;

export interface PluginInstalledPayload {
  readonly name: string;
  readonly version: string;
  readonly actorId: string;
  readonly at: string;
}

export interface PluginScopePayload {
  readonly name: string;
  readonly version: string;
  readonly guildId: string | null;
  readonly actorId: string;
  readonly at: string;
}

export interface PluginUpdatedPayload {
  readonly name: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly actorId: string;
  readonly at: string;
}

export interface PluginRemovedPayload {
  readonly name: string;
  readonly actorId: string;
  readonly at: string;
}

export interface PluginErroredPayload {
  readonly name: string;
  readonly phase:
    'load' | 'install' | 'enable' | 'disable' | 'update' | 'remove' | 'runtime';
  readonly guildId: string | null;
  readonly message: string;
  readonly at: string;
}
