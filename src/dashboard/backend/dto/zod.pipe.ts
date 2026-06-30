import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates input against a Zod schema; maps failures to a safe 400 payload. */
@Injectable()
export class DashboardZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      message: 'Validation failed',
      errors: result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        issue: i.message,
      })),
    });
  }
}

export function dashZod<T>(schema: ZodType<T>): DashboardZodPipe<T> {
  return new DashboardZodPipe(schema);
}
