import { ValidationError } from '@template/errors'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireStaff } from '@/middleware/require-staff.js'
import { getSentEmailController, listSentEmailsController } from './controllers.js'
import { listQuerySchema } from './schemas.js'

export const sentEmailsAdminRoutes = new Hono()

sentEmailsAdminRoutes.get('/:entityId', requireStaff, async (c) => {
  const result = await getSentEmailController(c.req.param('entityId'))

  return c.json(result)
})

sentEmailsAdminRoutes.get('/', requireStaff, async (c) => {
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))

  if (!parsed.success) throw new ValidationError('Invalid query', z.treeifyError(parsed.error))

  const result = await listSentEmailsController(parsed.data)

  return c.json(result)
})
