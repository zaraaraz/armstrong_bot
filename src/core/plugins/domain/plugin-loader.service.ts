import { Injectable, Logger } from '@nestjs/common';
import { createRequire } from 'module';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import type { Plugin, PluginFactory } from '../contracts/plugin.interface';
import { PluginError, PluginErrorCode } from '../errors/plugin.errors';
import { PluginManifestSchema } from './plugin-manifest.schema';

const nativeRequire = createRequire(__filename);

@Injectable()
export class PluginLoaderService {
  private readonly logger = new Logger(PluginLoaderService.name);

  async load(pluginPath: string, expectedChecksum?: string): Promise<Plugin> {
    const resolved = path.resolve(pluginPath);

    if (expectedChecksum) {
      await this.verifyChecksum(resolved, expectedChecksum);
    }

    let factory: PluginFactory;
    try {
      const mod = nativeRequire(resolved) as
        { default?: PluginFactory } | PluginFactory;
      factory =
        typeof mod === 'function'
          ? mod
          : (mod as { default: PluginFactory }).default;
      if (typeof factory !== 'function') {
        throw new PluginError(
          PluginErrorCode.LoadFailed,
          `Plugin at "${pluginPath}" does not export a factory function`,
        );
      }
    } catch (err) {
      if (err instanceof PluginError) throw err;
      throw new PluginError(
        PluginErrorCode.LoadFailed,
        `Failed to require plugin: ${String(err)}`,
        undefined,
        err,
      );
    }

    const plugin = await factory();
    this.validateManifest(plugin);
    return plugin;
  }

  unload(pluginPath: string): void {
    const resolved = path.resolve(pluginPath);
    delete nativeRequire.cache[resolved];
    this.logger.debug(`Unloaded plugin module: ${resolved}`);
  }

  private validateManifest(plugin: Plugin): void {
    const result = PluginManifestSchema.safeParse(plugin.manifest);
    if (!result.success) {
      throw new PluginError(
        PluginErrorCode.ManifestInvalid,
        `Invalid plugin manifest: ${result.error.message}`,
        plugin.manifest?.name,
      );
    }
  }

  private async verifyChecksum(
    filePath: string,
    expected: string,
  ): Promise<void> {
    const buf = await fs.readFile(filePath);
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (actual !== expected) {
      throw new PluginError(
        PluginErrorCode.ChecksumMismatch,
        `Checksum mismatch for "${filePath}": expected ${expected}, got ${actual}`,
      );
    }
  }
}
