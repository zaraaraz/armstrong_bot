import { Injectable, Logger } from '@nestjs/common';
import { createRequire } from 'module';
import * as vm from 'vm';

/**
 * Lightweight sandbox wrapper. Runs plugin hooks in a vm context with a
 * restricted require shim so plugins cannot import host internals.
 */
@Injectable()
export class PluginSandbox {
  private readonly logger = new Logger(PluginSandbox.name);

  private readonly allowedModules = new Set([
    '@ghost/plugin-sdk',
    'discord.js',
  ]);

  createRequireShim(pluginDeclaredDeps: readonly string[]): NodeRequire {
    const allowed = new Set([...this.allowedModules, ...pluginDeclaredDeps]);
    const nativeRequire = createRequire(__filename);

    const shim = (id: string): unknown => {
      if (!allowed.has(id)) {
        throw new Error(`Plugin is not allowed to require "${id}"`);
      }
      return nativeRequire(id);
    };

    return shim as NodeRequire;
  }

  runInContext<T>(code: string, context: Record<string, unknown>): T {
    const sandbox = vm.createContext({ ...context });
    return vm.runInContext(code, sandbox) as T;
  }
}
