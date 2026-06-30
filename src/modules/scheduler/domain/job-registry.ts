import { Injectable, Logger } from '@nestjs/common';
import type { JobKind } from './job-kind.enum';
import type { JobHandler } from './job-handler.interface';

/**
 * Public contract for the process-local handler map. Consuming modules register
 * their {@link JobHandler}s here at bootstrap; the worker resolves by kind.
 */
export abstract class JobRegistry {
  abstract register<T>(handler: JobHandler<T>): void;
  abstract resolve(kind: JobKind | string): JobHandler | undefined;
  abstract list(): ReadonlyArray<string>;
}

@Injectable()
export class InMemoryJobRegistry extends JobRegistry {
  private readonly logger = new Logger(InMemoryJobRegistry.name);
  private readonly handlers = new Map<string, JobHandler>();

  register<T>(handler: JobHandler<T>): void {
    const kind = String(handler.kind);
    if (this.handlers.has(kind)) {
      throw new Error(
        `JobRegistry: a handler for kind "${kind}" is already registered`,
      );
    }
    this.handlers.set(kind, handler);
    this.logger.log(`Registered job handler for kind "${kind}"`);
  }

  resolve(kind: JobKind | string): JobHandler | undefined {
    return this.handlers.get(String(kind));
  }

  list(): ReadonlyArray<string> {
    return [...this.handlers.keys()];
  }
}
