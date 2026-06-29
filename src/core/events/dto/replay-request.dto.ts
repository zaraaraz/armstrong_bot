import { z } from 'zod';

export const replayRequestSchema = z.object({
  eventName: z.string().optional(),
  guildId: z.string().optional(),
  correlationId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(10_000).default(500),
});
export type ReplayRequestDto = z.infer<typeof replayRequestSchema>;
