import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

interface CorrelationContext {
  readonly correlationId: string;
  readonly causationId: string | null;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export const CorrelationContext = {
  run<T>(ctx: CorrelationContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  get(): CorrelationContext {
    return (
      storage.getStore() ?? { correlationId: randomUUID(), causationId: null }
    );
  },

  fork(causationId: string): CorrelationContext {
    const current = CorrelationContext.get();
    return { correlationId: current.correlationId, causationId };
  },
};
