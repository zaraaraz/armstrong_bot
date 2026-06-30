import { Injectable, type PipeTransform } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { ApiException } from '../errors/api-exception';
import type { FieldError } from '../envelope/error-envelope';

/**
 * Validates and coerces a request payload against a Zod schema, producing a
 * fully-typed DTO. On failure it throws an {@link ApiException} with
 * `VALIDATION_FAILED` and per-field details — never a raw Zod error.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const details: FieldError[] = result.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      issue: issue.message,
    }));
    throw ApiException.validation('Request validation failed.', details);
  }
}

/** Convenience factory so controllers can write `@Query(zodPipe(schema))`. */
export function zodPipe<T>(schema: ZodType<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

export { z };
