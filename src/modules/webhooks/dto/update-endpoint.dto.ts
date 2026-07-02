import { z } from 'zod';

/**
 * Body for `PATCH .../webhooks/endpoints/:id`. Both fields are optional but at
 * least one must be supplied, so a no-op patch is rejected at the boundary.
 */
export const updateEndpointSchema = z
  .object({
    label: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (value) => value.label !== undefined || value.enabled !== undefined,
    'at least one of label or enabled is required',
  );

export type UpdateEndpointInput = z.infer<typeof updateEndpointSchema>;
