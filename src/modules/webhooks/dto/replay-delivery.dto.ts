import { z } from 'zod';

/**
 * Body for `POST .../webhooks/deliveries/:id/replay`. Verification is skipped by
 * default because the delivery was already verified when first received; set
 * `skipVerification: false` to force a fresh signature check on replay.
 */
export const replayDeliverySchema = z.object({
  skipVerification: z.boolean().default(true),
});

export type ReplayDeliveryInput = z.infer<typeof replayDeliverySchema>;
