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

const priorityEnum = z.enum(['low', 'normal', 'high', 'critical']);

const recipientSchema = z
  .object({
    userId: z.string().min(1).max(32).optional(),
    channelId: z.string().min(1).max(32).optional(),
    email: z.string().email().optional(),
    pushEndpoint: z.string().min(1).optional(),
    webhookUrl: z.string().url().optional(),
  })
  .refine(
    (r) =>
      Boolean(
        r.userId || r.channelId || r.email || r.pushEndpoint || r.webhookUrl,
      ),
    { message: 'recipient must carry at least one target' },
  );

/** Scalar-only vars (mirrors the public TemplateVars — no nested objects). */
const varsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

export const dispatchNotificationSchema = z.object({
  category: categoryEnum,
  priority: priorityEnum.optional(),
  templateKey: z.string().min(1).max(191),
  vars: varsSchema.default({}),
  recipients: z.array(recipientSchema).min(1).max(1000),
  channels: z.array(channelEnum).min(1).optional(),
  dedupeKey: z.string().min(1).max(191).optional(),
  localeOverride: z.string().min(2).max(10).optional(),
});

export type DispatchNotificationDtoParsed = z.infer<
  typeof dispatchNotificationSchema
>;
