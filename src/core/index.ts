export { CoreModule } from './core.module';
export { EventBus } from './events/event-bus';
export type {
  DomainEvent,
  EventHandler,
  Unsubscribe,
  EventMeta,
} from './events/event-bus';
export { ModuleRegistry } from './module-system/module-registry';
export type { RegisteredModule } from './module-system/module-registry';
export { BaseModule } from './module-system/base.module';
export type { ModuleManifest } from './module-system/module-manifest';
export { LifecyclePhase } from './kernel/lifecycle.types';
export type { LifecycleContext } from './kernel/lifecycle.types';
export { HealthService } from './health/health.service';
export type {
  HealthContributor,
  HealthCheckResult,
  HealthState,
} from './health/health-contributor';
export { ShutdownService } from './kernel/shutdown.service';
