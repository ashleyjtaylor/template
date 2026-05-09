import type { AuditLog, Prisma } from '@prisma/client'
import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '@/lib/db.js'
import { NotFoundError, ValidationError } from '@/lib/errors.js'
import { requireStaff } from '@/middleware/require-staff.js'

const listQuerySchema = z.object({
  action: z.string().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  requestId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50)
})

// Cursor encodes (createdAt, entityId) so pagination is stable when new rows
// arrive at the head between page fetches. Sort: createdAt DESC, entityId
// DESC as the secondary key.
const cursorSchema = z.object({ createdAt: z.string(), entityId: z.string() })
type Cursor = z.infer<typeof cursorSchema>

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')

const decodeCursor = (s: string): Cursor => {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(s, 'base64url').toString('utf8')))
  } catch {
    throw new ValidationError('Invalid cursor')
  }
}

interface ActorInfo {
  entityId: string
  email: string
}

const buildActorMap = async (entityIds: ReadonlySet<string>): Promise<Map<string, ActorInfo>> => {
  if (entityIds.size === 0) return new Map()

  const users = await prisma.user.findMany({
    where: { entityId: { in: [...entityIds] } },
    select: { entityId: true, email: true }
  })

  return new Map(users.map((u) => [u.entityId, u]))
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

const collectActorIds = (rows: readonly AuditLog[]): Set<string> => {
  const ids = new Set<string>()

  for (const r of rows) {
    if (r.actorUserId) ids.add(r.actorUserId)
    if (r.actorImpersonatorId) ids.add(r.actorImpersonatorId)
  }

  return ids
}

export const auditLogRoutes = new Hono()

// /actions declared before /:entityId — Hono evaluates routes in declaration
// order; /:entityId would otherwise capture "actions" as the param.
auditLogRoutes.get('/actions', requireStaff, async (c) => {
  const rows = await prisma.auditLog.findMany({
    distinct: ['action'],
    select: { action: true },
    orderBy: { action: 'asc' }
  })

  return c.json({ actions: rows.map((r) => r.action) })
})

auditLogRoutes.get('/:entityId', requireStaff, async (c) => {
  const entityId = c.req.param('entityId')
  const row = await prisma.auditLog.findUnique({ where: { entityId } })

  if (!row) throw new NotFoundError('Audit log entry not found')

  const actors = await buildActorMap(collectActorIds([row]))

  return c.json(toRow(row, actors))
})

auditLogRoutes.get('/', requireStaff, async (c) => {
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))

  if (!parsed.success) throw new ValidationError('Invalid query', z.treeifyError(parsed.error))

  const { action, from, to, requestId, cursor, limit } = parsed.data
  const where: Prisma.AuditLogWhereInput = {}

  if (action) where.action = action

  if (requestId) where.requestId = requestId

  if (from || to) {
    const range: Prisma.DateTimeFilter = {}

    if (from) range.gte = new Date(from)

    if (to) range.lte = new Date(to)

    where.createdAt = range
  }

  if (cursor) {
    const decoded = decodeCursor(cursor)
    const cursorDate = new Date(decoded.createdAt)

    where.OR = [
      { createdAt: { lt: cursorDate } },
      { createdAt: cursorDate, entityId: { lt: decoded.entityId } }
    ]
  }

  const fetched = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { entityId: 'desc' }],
    take: limit + 1
  })

  const hasMore = fetched.length > limit
  const trimmed = hasMore ? fetched.slice(0, limit) : fetched

  const actors = await buildActorMap(collectActorIds(trimmed))

  const last = trimmed[trimmed.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({ createdAt: last.createdAt.toISOString(), entityId: last.entityId })
      : null

  return c.json({
    rows: trimmed.map((r) => toRow(r, actors)),
    nextCursor
  })
})
