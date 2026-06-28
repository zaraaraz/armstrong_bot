import type { ModuleManifest } from './module-manifest';
import type { LifecycleContext } from '../kernel/lifecycle.types';

export interface HealthContributor {
  readonly name: string;
  check(): Promise<{ state: 'up' | 'down' | 'degraded'; detail?: Record<string, string | number | boolean> }>;
}

export abstract class BaseModule {
  abstract readonly manifest: ModuleManifest;

  abstract onRegister(ctx: LifecycleContext): Promise<void>;

  onBootstrap?(ctx: LifecycleContext): Promise<void>;

  onShutdown?(ctx: LifecycleContext): Promise<void>;

  healthContributor?(): HealthContributor;
}
