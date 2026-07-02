import { z } from 'zod';

const channelEnum = z.enum([
  'DISCORD_DM',
  'DISCORD_CHANNEL',
  'WEBHOOK',
  'EMAIL',
  'PUSH',
]);

const categoryEnum = z.enum([
  'system',
  'moderation',
  'tickets',
  'integrations',
  'digest',
  'marketing',
]);

/** A single category × channel toggle. */
export const preferenceEntrySchema = z.object({
  category: categoryEnum,
  channel: channelEnum,
  enabled: z.boolean(),
});

export const updatePreferencesSchema = z.object({
  preferences: z.array(preferenceEntrySchema).min(1).max(100),
});

export type UpdatePreferencesDtoParsed = z.infer<
  typeof updatePreferencesSchema
>;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const notificationsListQuerySchema = listQuerySchema.extend({
  category: categoryEnum.optional(),
});

export type NotificationsListQueryParsed = z.infer<
  typeof notificationsListQuerySchema
>;
