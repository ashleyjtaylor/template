import type { AuditLog } from '@prisma/client'
import { NotFoundError } from '@template/errors'
import { decodeCursor, encodeCursor, type ListQuery } from '@/modules/audit-log/schemas.js'
import {
  type ActorInfo,
  findActorsByEntityIds,
  getAuditLogById,
  listAuditLog,
  listDistinctActions
} from '@/modules/audit-log/service.js'

const collectActorIds = (rows: readonly AuditLog[]): Set<string> => {
  const ids = new Set<string>()

  for (const r of rows) {
    if (r.actorUserId) ids.add(r.actorUserId)

    if (r.actorImpersonatorId) ids.add(r.actorImpersonatorId)
  }

  return ids
}

const toRow = (r: AuditLog, actors: Map<string, ActorInfo>) => ({
  entityId: r.entityId,
  createdAt: r.createdAt.toISOString(),
  action: r.action,
  actorUser: r.actorUserId ? (actors.get(r.actorUserId) ?? null) : null,
  actorImpersonator: r.actorImpersonatorId ? (actors.get(r.actorImpersonatorId) ?? null) : null,
  resourceType: r.resourceType,
  resourceId: r.resourceId,
  ipAddress: r.ipAddress,
  userAgent: r.userAgent,
  requestId: r.requestId,
  details: r.details
})

export async function listAuditLogController(query: ListQuery) {
  const { action, from, to, requestId, cursor, limit } = query

  const cursorParsed = cursor ? decodeCursor(cursor) : null
  const fetched = await listAuditLog(
    {
      action,
      requestId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined
    },
    cursorParsed,
    limit
  )

  const hasMore = fetched.length > limit
  const trimmed = hasMore ? fetched.slice(0, limit) : fetched

  const actors = await findActorsByEntityIds(collectActorIds(trimmed))

  const last = trimmed[trimmed.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.entityId) : null

  return {
    rows: trimmed.map((r) => toRow(r, actors)),
    nextCursor
  }
}

export async function getAuditLogController(entityId: string) {
  const row = await getAuditLogById(entityId)

  if (!row) throw new NotFoundError('Audit log entry not found')

  const actors = await findActorsByEntityIds(collectActorIds([row]))

  return toRow(row, actors)
}

export async function listActionsController() {
  const actions = await listDistinctActions()

  return { actions }
}
