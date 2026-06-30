import type { ZodTypeAny } from 'zod';
import type { PluginScope } from './plugin.enums';

export interface PluginPermissionClaim {
  readonly claim: string;
  readonly description: string;
}

export interface PluginDependency {
  readonly name: string;
  readonly range: string;
  readonly required?: boolean;
}

export interface PluginManifest<TConfig = unknown> {
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly author: string;
  readonly scope: PluginScope;
  readonly sdkRange: string;
  readonly dependencies: readonly PluginDependency[];
  readonly permissions: readonly PluginPermissionClaim[];
  readonly services: readonly string[];
  readonly configSchema: ZodTypeAny;
  readonly i18nNamespaces: readonly string[];
  readonly checksum?: string;
  // phantom type to satisfy the generic param
  readonly _config?: TConfig;
}
