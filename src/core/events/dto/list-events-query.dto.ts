import { z } from 'zod';

export const listEventsQuerySchema = z.object({
  eventName: z.string().optional(),
  guildId: z.string().optional(),
  correlationId: z.string().optional(),
  status: z.enum(['published', 'dispatched', 'failed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListEventsQueryDto = z.infer<typeof listEventsQuerySchema>;
