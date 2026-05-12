import { ValidationError } from '@template/errors'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireStaff } from '@/middleware/require-staff.js'
import { getOrgBillingDetailController, listAdminOrgsController } from './controllers.js'
import { listQuerySchema } from './schemas.js'

export const orgsAdminRoutes = new Hono()

// Detail route declared first so :entityId/billing doesn't shadow it.
orgsAdminRoutes.get('/:entityId/billing', requireStaff, async (c) => {
  const result = await getOrgBillingDetailController(c.req.param('entityId'))

  return c.json(result)
})

orgsAdminRoutes.get('/', requireStaff, async (c) => {
  const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))

  if (!parsed.success) throw new ValidationError('Invalid query', z.treeifyError(parsed.error))

  const result = await listAdminOrgsController(parsed.data)

  return c.json(result)
})
