export interface ModuleManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly dependsOn: readonly string[];
  readonly permissions: readonly string[];
  readonly emits: readonly string[];
  readonly consumes: readonly string[];
  readonly i18nNamespaces: readonly string[];
  readonly guildScoped: boolean;
}
