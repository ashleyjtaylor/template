import { Hono } from 'hono'
import { requireAdmin, requireMember } from '@/middleware/require-org-role.js'
import {
  createCheckoutSessionController,
  createPortalSessionController,
  getAccessStateController
} from './controllers.js'

export const billingRoutes = new Hono()

billingRoutes.post('/:orgId/billing/checkout-session', requireAdmin, async (c) => {
  const result = await createCheckoutSessionController(
    c.req.param('orgId') ?? '',
    c.get('authSession')
  )

  return c.json(result)
})

billingRoutes.post('/:orgId/billing/portal-session', requireAdmin, async (c) => {
  const result = await createPortalSessionController(c.req.param('orgId') ?? '')

  return c.json(result)
})

billingRoutes.get('/:orgId/billing/access-state', requireMember, async (c) => {
  const result = await getAccessStateController(c.req.param('orgId') ?? '')

  return c.json(result)
})
