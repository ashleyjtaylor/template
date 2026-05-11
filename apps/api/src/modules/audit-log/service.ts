import type { Prisma } from '@template/db'
import { prisma } from '@template/db'
import { getRequestId, logger } from '@/lib/logger.js'
import type { AuditContext, AuditEvent } from '@/modules/audit-log/events.js'

// Best-effort: writes the row, awaits it (so caller sees timing in the
// originating request), but catches everything and logs at error level. The
// originating request never sees an audit-write failure — losing one event
// is preferable to failing a real user action because of an audit bug.
export async function writeAudit(event: AuditEvent, context: AuditContext = {}) {
  try {
    const { action } = event
    const actorUserId = 'actorUserId' in event ? event.actorUserId : null
    const resourceId = 'resourceId' in event ? event.resourceId : null
    const resourceType = action.split('.')[0] ?? null

    await prisma.auditLog.create({
      data: {
        entityId: `aud_${crypto.randomUUID()}`,
        requestId: getRequestId() ?? null,
        action,
        actorUserId,
        actorImpersonatorId: context.actorImpersonatorId ?? null,
        resourceType,
        resourceId,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        details: event as object
      }
    })
  } catch (err) {
    logger.error({ err, action: event.action }, 'audit write failed')
  }
}

export interface ListAuditLogFilters {
  action?: string | undefined
  requestId?: string | undefined
  from?: Date | undefined
  to?: Date | undefined
}

export interface AuditLogCursor {
  createdAt: Date
  entityId: string
}

export async function listAuditLog(
  filters: ListAuditLogFilters,
  cursor: AuditLogCursor | null,
  limit: number
) {
  const where: Prisma.AuditLogWhereInput = {}

  if (filters.action) where.action = filters.action

  if (filters.requestId) where.requestId = filters.requestId

  if (filters.from || filters.to) {
    const range: Prisma.DateTimeFilter = {}

    if (filters.from) range.gte = filters.from

    if (filters.to) range.lte = filters.to

    where.createdAt = range
  }

  if (cursor) {
    where.OR = [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, entityId: { lt: cursor.entityId } }
    ]
  }

  return prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { entityId: 'desc' }],
    take: limit + 1
  })
}

export async function getAuditLogById(entityId: string) {
  return prisma.auditLog.findUnique({ where: { entityId } })
}

export async function listDistinctActions() {
  const rows = await prisma.auditLog.findMany({
    distinct: ['action'],
    select: { action: true },
    orderBy: { action: 'asc' }
  })

  return rows.map((r) => r.action)
}

export interface ActorInfo {
  entityId: string
  email: string
}

export async function findActorsByEntityIds(
  entityIds: ReadonlySet<string>
): Promise<Map<string, ActorInfo>> {
  if (entityIds.size === 0) return new Map()

  const users = await prisma.user.findMany({
    where: { entityId: { in: [...entityIds] } },
    select: { entityId: true, email: true }
  })

  return new Map(users.map((u) => [u.entityId, u]))
}
