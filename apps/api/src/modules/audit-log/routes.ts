import { Hono } from 'hono'
import { z } from 'zod'
import { ValidationError } from '@/lib/errors.js'
import { requireStaff } from '@/middleware/require-staff.js'
import {
  getAuditLogController,
  listActionsController,
  listAuditLogController
} from '@/modules/audit-log/controllers.js'
import { listQuerySchema } from '@/modules/audit-log/schemas.js'

export const auditLogRoutes = new Hono()

auditLogRoutes.get('/actions', requireStaff, async (c) => {
  const result = await listActionsController()

  return c.json(result)
})

auditLogRoutes.get('/:entityId', requireStaff, async (c) => {
  const result = await getAuditLogController(c.req.param('entityId'))

  return c.json(result)
})

auditLogRoutes.get('/', requireStaff, async (c) => {
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))

  if (!parsed.success) throw new ValidationError('Invalid query', z.treeifyError(parsed.error))

  const result = await listAuditLogController(parsed.data)

  return c.json(result)
})
