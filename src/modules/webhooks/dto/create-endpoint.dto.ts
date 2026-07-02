import { z } from 'zod';
import { WEBHOOK_PROVIDERS } from '../domain/webhook-provider.enum';

/** Provider values as a non-empty string tuple for `z.enum`. */
const PROVIDER_VALUES = WEBHOOK_PROVIDERS as readonly [string, ...string[]];

/**
 * Body for `POST .../webhooks/endpoints`. The signing secret is client-supplied
 * (generated if omitted) and is write-only — it is never echoed back after the
 * once-only reveal on create/rotate.
 */
export const createEndpointSchema = z.object({
  provider: z.enum(PROVIDER_VALUES),
  label: z.string().min(1),
  signingSecret: z.string().min(1).optional(),
});

export type CreateEndpointInput = z.infer<typeof createEndpointSchema>;
