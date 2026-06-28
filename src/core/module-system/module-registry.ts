import { Injectable, Logger } from '@nestjs/common';
import type { BaseModule } from './base.module';
import type { ModuleManifest } from './module-manifest';

export interface RegisteredModule {
  readonly instance: BaseModule;
  readonly manifest: ModuleManifest;
  readonly registeredAt: Date;
}

@Injectable()
export class ModuleRegistry {
  private readonly logger = new Logger(ModuleRegistry.name);
  private readonly modules = new Map<string, RegisteredModule>();

  register(module: BaseModule): void {
    const { id } = module.manifest;
    if (this.modules.has(id)) {
      this.logger.warn(`Module "${id}" already registered — skipping`);
      return;
    }
    this.modules.set(id, { instance: module, manifest: module.manifest, registeredAt: new Date() });
    this.logger.log(`Module registered: ${id} v${module.manifest.version}`);
  }

  get(id: string): RegisteredModule | undefined {
    return this.modules.get(id);
  }

  all(): readonly RegisteredModule[] {
    return Array.from(this.modules.values());
  }

  resolveInitOrder(): readonly RegisteredModule[] {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const order: RegisteredModule[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (inStack.has(id)) throw new Error(`Circular dependency detected involving module "${id}"`);

      const reg = this.modules.get(id);
      if (!reg) throw new Error(`Unknown module dependency: "${id}"`);

      inStack.add(id);
      for (const dep of reg.manifest.dependsOn) visit(dep);
      inStack.delete(id);
      visited.add(id);
      order.push(reg);
    };

    for (const id of this.modules.keys()) visit(id);
    return order;
  }

  allPermissionClaims(): readonly string[] {
    return Array.from(this.modules.values()).flatMap((r) => [...r.manifest.permissions]);
  }
}
