import { Injectable } from '@nestjs/common';
import * as semver from 'semver';
import type {
  PluginManifest,
  PluginDependency,
} from '../contracts/plugin-manifest.interface';
import { PluginError, PluginErrorCode } from '../errors/plugin.errors';
import { PluginRegistry } from './plugin-registry';

@Injectable()
export class PluginDependencyResolver {
  constructor(private readonly registry: PluginRegistry) {}

  validateSdkRange(manifest: PluginManifest, hostSdkVersion: string): void {
    if (!semver.satisfies(hostSdkVersion, manifest.sdkRange)) {
      throw new PluginError(
        PluginErrorCode.SdkIncompatible,
        `Plugin "${manifest.name}" requires SDK ${manifest.sdkRange} but host is ${hostSdkVersion}`,
        manifest.name,
      );
    }
  }

  validateDependencies(manifest: PluginManifest): void {
    for (const dep of manifest.dependencies) {
      if (dep.required !== false) {
        const entry = this.registry.get(dep.name);
        if (!entry) {
          throw new PluginError(
            PluginErrorCode.DependencyMissing,
            `Plugin "${manifest.name}" requires "${dep.name}" which is not installed`,
            manifest.name,
          );
        }
        const depVersion = entry.plugin.manifest.version;
        if (!semver.satisfies(depVersion, dep.range)) {
          throw new PluginError(
            PluginErrorCode.DependencyIncompatible,
            `Plugin "${manifest.name}" requires "${dep.name}@${dep.range}" but installed version is ${depVersion}`,
            manifest.name,
          );
        }
      }
    }
  }

  topologicalOrder(manifests: PluginManifest[]): PluginManifest[] {
    const names = new Set(manifests.map((m) => m.name));
    const sorted: PluginManifest[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (manifest: PluginManifest) => {
      if (visited.has(manifest.name)) return;
      if (visiting.has(manifest.name)) {
        throw new PluginError(
          PluginErrorCode.DependencyCycle,
          `Dependency cycle detected involving "${manifest.name}"`,
          manifest.name,
        );
      }
      visiting.add(manifest.name);

      for (const dep of manifest.dependencies) {
        if (names.has(dep.name)) {
          const depManifest = manifests.find((m) => m.name === dep.name);
          if (depManifest) visit(depManifest);
        }
      }

      visiting.delete(manifest.name);
      visited.add(manifest.name);
      sorted.push(manifest);
    };

    for (const m of manifests) visit(m);
    return sorted;
  }

  validateDependency(dep: PluginDependency, installedVersion: string): void {
    if (!semver.satisfies(installedVersion, dep.range)) {
      throw new PluginError(
        PluginErrorCode.DependencyIncompatible,
        `Dependency "${dep.name}" version ${installedVersion} does not satisfy range ${dep.range}`,
      );
    }
  }
}
