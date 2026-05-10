import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { ValidationError } from '@/lib/errors.js'
import { requireAdmin } from '@/middleware/require-org-role.js'
import { requireSession } from '@/middleware/require-session.js'
import {
  acceptInvitationController,
  createInvitationController,
  getInvitationController,
  listInvitationsController,
  revokeInvitationController
} from '@/modules/org-invitations/controllers.js'
import {
  createInvitationSchema,
  listInvitationsQuerySchema
} from '@/modules/org-invitations/schemas.js'

const parseBody = async <T>(c: Context, schema: z.ZodType<T>) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    throw new ValidationError('Invalid body', z.treeifyError(parsed.error))
  }

  return parsed.data
}

export const orgInvitationRoutes = new Hono()

orgInvitationRoutes.post('/', requireAdmin, async (c) => {
  const input = await parseBody(c, createInvitationSchema)
  const result = await createInvitationController(
    c.req.param('orgId') ?? '',
    input,
    c.get('authSession'),
    c.get('orgMembership')
  )

  return c.json(result, 201)
})

orgInvitationRoutes.get('/', requireAdmin, async (c) => {
  const queryParsed = listInvitationsQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams)
  )

  if (!queryParsed.success) {
    throw new ValidationError('Invalid query', z.treeifyError(queryParsed.error))
  }

  const result = await listInvitationsController(c.req.param('orgId') ?? '', queryParsed.data)

  return c.json(result)
})

orgInvitationRoutes.delete('/:invitationId', requireAdmin, async (c) => {
  await revokeInvitationController(
    c.req.param('orgId') ?? '',
    c.req.param('invitationId'),
    c.get('authSession')
  )

  return c.body(null, 204)
})

export const orgInvitationAcceptRoutes = new Hono()

orgInvitationAcceptRoutes.get('/:token', async (c) => {
  const result = await getInvitationController(c.req.param('token'))

  return c.json(result)
})

orgInvitationAcceptRoutes.post('/:token/accept', requireSession, async (c) => {
  const result = await acceptInvitationController(c.req.param('token'), c.get('authSession'))

  return c.json(result)
})
