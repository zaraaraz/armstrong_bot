import { z } from 'zod';

export const createIntegrationSubscriptionSchema = z.object({
  provider: z.enum(['TWITCH', 'YOUTUBE', 'GITHUB']),
  externalId: z.string().min(1).max(191),
  announceChannelId: z.string().min(1).max(32).optional(),
});

export type CreateIntegrationSubscriptionParsed = z.infer<
  typeof createIntegrationSubscriptionSchema
>;
