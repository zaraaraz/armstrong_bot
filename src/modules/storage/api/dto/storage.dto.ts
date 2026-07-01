import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { StorageNamespace } from '../../domain/storage-namespace';

/**
 * Query parameters for the paginated catalog listing. Zod-validated (mirrors the
 * Scheduler's `jobQuerySchema`) so raw string query params are coerced to their
 * proper types and bounded before reaching {@link StorageService}. `guildId` is
 * a caller hint only — the controller overrides it with the request scope so a
 * guild-scoped caller can never list another guild's objects.
 */
export const listObjectsQuerySchema = z.object({
  guildId: z.string().optional(),
  namespace: z.nativeEnum(StorageNamespace).optional(),
  ownerType: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListObjectsQuery = z.infer<typeof listObjectsQuerySchema>;

/**
 * Swagger-only description of the list query. The runtime source of truth is
 * {@link listObjectsQuerySchema}; this class exists purely so the parameters
 * render in the OpenAPI document.
 */
export class ListObjectsQueryDto {
  @ApiPropertyOptional({
    description: 'Restrict to a single guild (null/omitted => global objects).',
  })
  guildId?: string;

  @ApiPropertyOptional({ enum: StorageNamespace })
  namespace?: StorageNamespace;

  @ApiPropertyOptional({
    description: "Owning entity kind, e.g. 'ticket' | 'guild' | 'user'.",
  })
  ownerType?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  pageSize?: number;
}

/** A single catalog row as exposed to the dashboard/admin API. */
export class StorageObjectResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'null => global object (not scoped to a guild).',
  })
  guildId!: string | null;

  @ApiProperty({ enum: StorageNamespace })
  namespace!: StorageNamespace;

  @ApiProperty({ description: 'sha256 hex — the dedupe anchor.' })
  contentHash!: string;

  @ApiProperty({ description: 'Object size in bytes.' })
  size!: number;

  @ApiProperty()
  contentType!: string;

  @ApiProperty({ nullable: true, type: String })
  filename!: string | null;

  @ApiProperty({ description: "Owning entity kind, e.g. 'ticket' | 'guild'." })
  ownerType!: string;

  @ApiProperty()
  ownerId!: string;

  @ApiProperty({ description: 'ISO-8601 creation timestamp.' })
  createdAt!: string;
}

/** Paginated envelope for a page of catalog rows. */
export class PaginatedStorageObjectsDto {
  @ApiProperty({ type: [StorageObjectResponseDto] })
  items!: StorageObjectResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

/** Aggregated per-guild usage powering the dashboard quota gauge. */
export class StorageUsageResponseDto {
  @ApiProperty()
  guildId!: string;

  @ApiProperty({ description: 'Bytes currently attributed to the guild.' })
  usedBytes!: number;

  @ApiProperty({
    description: 'Configured quota in bytes (0 => unlimited).',
  })
  quotaBytes!: number;

  @ApiProperty({ description: 'Number of live (non-deleted) objects.' })
  objectCount!: number;

  @ApiProperty({ nullable: true, type: String })
  updatedAt!: string | null;
}

/** A time-limited download link, as returned to the caller. */
export class SignedUrlResponseDto {
  @ApiProperty()
  url!: string;

  @ApiProperty({ enum: ['GET', 'PUT'] })
  method!: 'GET' | 'PUT';

  @ApiProperty({ description: 'ISO-8601 expiry instant.' })
  expiresAt!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Headers the caller must send with the request (PUT).',
  })
  headers?: Record<string, string>;
}
