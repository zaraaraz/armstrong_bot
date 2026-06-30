import type { ZodSchema } from 'zod';

export interface EventContract<TPayload> {
  readonly name: string;
  readonly schema: ZodSchema<TPayload>;
}

export function assertEventContract<T>(
  contract: EventContract<T>,
  payload: unknown,
): asserts payload is T {
  const result = contract.schema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      `Event contract violation for "${contract.name}":\n${JSON.stringify(result.error.flatten(), null, 2)}`,
    );
  }
}
