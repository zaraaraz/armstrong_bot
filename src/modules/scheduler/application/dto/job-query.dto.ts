import { z } from 'zod';

const statusEnum = z.enum([
  'pending',
  'active',
  'paused',
  'completed',
  'cancelled',
  'failed',
]);

export const jobQuerySchema = z.object({
  guildId: z.string().optional(),
  kind: z.string().optional(),
  status: statusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type JobQueryDto = z.infer<typeof jobQuerySchema>;

export const runQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type RunQueryDto = z.infer<typeof runQuerySchema>;
