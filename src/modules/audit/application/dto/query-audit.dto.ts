import { z } from 'zod';
import { AuditScope, AuditSource } from '../../domain/audit-scope.enum';

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'invalid ISO-8601 date')
  .transform((v) => new Date(v));

export const auditQuerySchema = z.object({
  scope: z.nativeEnum(AuditScope).optional(),
  actorId: z.string().max(64).optional(),
  action: z.string().max(191).optional(), // exact, or prefix ending with '.'
  targetType: z.string().max(64).optional(),
  targetId: z.string().max(191).optional(),
  correlationId: z.string().max(64).optional(),
  source: z.nativeEnum(AuditSource).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
});

export type AuditQueryDto = z.infer<typeof auditQuerySchema>;

export const exportAuditSchema = auditQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({
    format: z.enum(['json', 'ndjson', 'csv']).default('ndjson'),
    from: isoDate.optional(),
    to: isoDate.optional(),
  });

export type ExportAuditDto = z.infer<typeof exportAuditSchema>;

export const retentionUpdateSchema = z
  .object({
    retentionDays: z.number().int().min(30).max(3650).optional(),
    archiveBeforeDelete: z.boolean().optional(),
    archiveFormat: z.enum(['json', 'ndjson', 'csv']).optional(),
  })
  .refine(
    (v) =>
      v.retentionDays !== undefined ||
      v.archiveBeforeDelete !== undefined ||
      v.archiveFormat !== undefined,
    'at least one retention field is required',
  );

export type RetentionUpdateDto = z.infer<typeof retentionUpdateSchema>;
