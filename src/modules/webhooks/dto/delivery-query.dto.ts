import { z } from 'zod';
import { DELIVERY_STATUSES } from '../domain/delivery-status.enum';
import { WEBHOOK_PROVIDERS } from '../domain/webhook-provider.enum';

/** Enum tuples for `z.enum` (non-empty string tuples). */
const PROVIDER_VALUES = WEBHOOK_PROVIDERS as readonly [string, ...string[]];
const STATUS_VALUES = DELIVERY_STATUSES as readonly [string, ...string[]];

/**
 * Query string for the paginated, filterable delivery log. Numeric params are
 * coerced from their string representation; `page`/`pageSize` fall back to sane
 * defaults and `pageSize` is capped to protect the database.
 */
export const deliveryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  provider: z.enum(PROVIDER_VALUES).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  eventType: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type DeliveryQueryInput = z.infer<typeof deliveryQuerySchema>;
