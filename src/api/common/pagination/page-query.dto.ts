import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export interface PageQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly offset?: number;
  readonly sort: string;
}

/** Hard ceiling for `limit`, matching `apiConfig.pagination.maxLimit`. */
export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 25;

export const pageQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z][a-zA-Z0-9_]*$/)
    .default('-createdAt'),
});

/** Shared pagination query DTO — cursor preferred, offset supported. */
export class PageQueryDto implements PageQuery {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  })
  limit: number = DEFAULT_PAGE_LIMIT;

  @ApiPropertyOptional({ description: 'Opaque base64 cursor (preferred).' })
  cursor?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Fallback offset pagination.',
  })
  offset?: number;

  @ApiPropertyOptional({
    default: '-createdAt',
    description: 'Sort field; leading "-" for descending.',
  })
  sort: string = '-createdAt';

  static readonly schema = pageQuerySchema;
}

/** Parsed sort directive. */
export interface SortSpec {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

export function parseSort(sort: string): SortSpec {
  if (sort.startsWith('-')) {
    return { field: sort.slice(1), direction: 'desc' };
  }
  return { field: sort, direction: 'asc' };
}
