import { Logger } from '@nestjs/common';
import type { EventBus } from '../events/event-bus';
import type { ModuleRegistry } from '../module-system/module-registry';

export enum LifecyclePhase {
  Constructed = 'constructed',
  Registered = 'registered',
  Bootstrapped = 'bootstrapped',
  Running = 'running',
  ShuttingDown = 'shutting_down',
  Stopped = 'stopped',
}

export interface LifecycleContext {
  readonly eventBus: EventBus;
  readonly registry: ModuleRegistry;
  readonly logger: Logger;
  readonly phase: LifecyclePhase;
}
