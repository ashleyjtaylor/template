import { z } from 'zod'

// Wire shape returned by /api/audit-log and /api/audit-log/:entityId.
// Single source of truth — both the list and detail routes import this.
export const auditLogRowSchema = z.object({
  entityId: z.string(),
  createdAt: z.string(),
  action: z.string(),
  actorUser: z.object({ entityId: z.string(), email: z.string() }).nullable(),
  actorImpersonator: z.object({ entityId: z.string(), email: z.string() }).nullable(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  details: z.unknown()
})

export type AuditLogRow = z.infer<typeof auditLogRowSchema>

export const auditLogListSchema = z.object({
  rows: z.array(auditLogRowSchema),
  nextCursor: z.string().nullable()
})

export type AuditLogList = z.infer<typeof auditLogListSchema>

export const auditLogActionsSchema = z.object({
  actions: z.array(z.string())
})

export type AuditLogActions = z.infer<typeof auditLogActionsSchema>

// Search params kept as datetime-local strings (browser-tz) for direct binding
// to <input type="datetime-local">. Converted to ISO at the API call site so
// the server gets timezone-anchored values.
export const auditLogSearchSchema = z.object({
  action: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  requestId: z.string().optional()
})

export type AuditLogSearch = z.infer<typeof auditLogSearchSchema>
