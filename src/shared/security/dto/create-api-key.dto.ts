import { z } from 'zod';

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(z.string().min(1)).max(50),
  expiresAt: z.string().datetime().optional(),
});

export type CreateApiKeyDto = z.infer<typeof CreateApiKeySchema>;

/** Returned once on creation — includes the raw key, shown a single time. */
export interface CreatedApiKeyResponseDto {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string | null;
  readonly createdAt: string;
  /** The raw key. Store it now — it is never retrievable again. */
  readonly rawKey: string;
}

/** Listing shape — never exposes the hash or raw key. */
export interface ApiKeyResponseDto {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
}
