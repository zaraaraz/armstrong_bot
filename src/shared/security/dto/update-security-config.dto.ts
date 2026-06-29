import { z } from 'zod';
import { SecurityConfigSchema } from '../schemas/security-config.schema';

/**
 * PATCH accepts any subset of the top-level config sections; each provided
 * section is validated in full against its schema.
 */
export const UpdateSecurityConfigSchema = SecurityConfigSchema.partial();

export type UpdateSecurityConfigDto = z.infer<
  typeof UpdateSecurityConfigSchema
>;
