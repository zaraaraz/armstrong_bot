export enum PluginErrorCode {
  ManifestInvalid = 'PLUGIN_MANIFEST_INVALID',
  SdkIncompatible = 'PLUGIN_SDK_INCOMPATIBLE',
  DependencyMissing = 'PLUGIN_DEPENDENCY_MISSING',
  DependencyIncompatible = 'PLUGIN_DEPENDENCY_INCOMPATIBLE',
  DependencyCycle = 'PLUGIN_DEPENDENCY_CYCLE',
  LoadFailed = 'PLUGIN_LOAD_FAILED',
  HookFailed = 'PLUGIN_HOOK_FAILED',
  HookTimeout = 'PLUGIN_HOOK_TIMEOUT',
  InvalidTransition = 'PLUGIN_INVALID_TRANSITION',
  ServiceAccessDenied = 'PLUGIN_SERVICE_ACCESS_DENIED',
  ChecksumMismatch = 'PLUGIN_CHECKSUM_MISMATCH',
  NotFound = 'PLUGIN_NOT_FOUND',
  AlreadyInstalled = 'PLUGIN_ALREADY_INSTALLED',
  ConfigInvalid = 'PLUGIN_CONFIG_INVALID',
}

export class PluginError extends Error {
  constructor(
    public readonly code: PluginErrorCode,
    message: string,
    public readonly pluginName?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PluginError';
  }
}
