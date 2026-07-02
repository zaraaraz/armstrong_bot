import { z } from 'zod';

/**
 * Body for `POST .../webhooks/subscriptions`. The target must be an HTTPS URL
 * (plaintext delivery is never allowed). `eventType` is validated against the
 * configured outbound allowlist by the service layer, not here.
 */
export const createSubscriptionSchema = z.object({
  eventType: z.string().min(1),
  targetUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), 'must be https'),
  signingSecret: z.string().min(1).optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
});

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
