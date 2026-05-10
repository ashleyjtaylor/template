import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { ValidationError } from '@/lib/errors.js'
import { requireAdmin, requireMember, requireOwner } from '@/middleware/require-org-role.js'
import { requireSession } from '@/middleware/require-session.js'
import {
  acceptInvitationController,
  changeRoleController,
  createInvitationController,
  createOrgController,
  getInvitationController,
  getOrgController,
  leaveOrgController,
  listInvitationsController,
  listMembersController,
  listMyOrgsController,
  orgSignUpController,
  removeMemberController,
  revokeInvitationController,
  transferOwnershipController,
  updateOrgController
} from '@/modules/organisations/controllers.js'
import {
  changeRoleSchema,
  createInvitationSchema,
  createOrgSchema,
  listInvitationsQuerySchema,
  orgSignUpSchema,
  transferOwnershipSchema,
  updateOrgSchema
} from '@/modules/organisations/schemas.js'

const parseBody = async <T>(c: Context, schema: z.ZodType<T>) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    throw new ValidationError('Invalid body', z.treeifyError(parsed.error))
  }

  return parsed.data
}

export const orgRoutes = new Hono()

orgRoutes.post('/sign-up', async (c) => {
  const input = await parseBody(c, orgSignUpSchema)
  const result = await orgSignUpController(input, c.req.raw.headers)

  if (result.kind === 'passthrough') return result.response

  if (result.setCookieHeader) c.header('set-cookie', result.setCookieHeader)

  return c.json(
    {
      user: result.user,
      organisation: result.organisation,
      membership: result.membership
    },
    200
  )
})

orgRoutes.get('/', requireSession, async (c) => {
  const result = await listMyOrgsController(c.get('authSession'))

  return c.json(result)
})

orgRoutes.post('/', requireSession, async (c) => {
  const input = await parseBody(c, createOrgSchema)
  const result = await createOrgController(input, c.get('authSession'))

  return c.json(result, 200)
})

orgRoutes.get('/:orgId', requireMember, async (c) => {
  const result = await getOrgController(c.req.param('orgId'), c.get('orgMembership'))

  return c.json(result)
})

orgRoutes.patch('/:orgId', requireAdmin, async (c) => {
  const input = await parseBody(c, updateOrgSchema)
  const result = await updateOrgController(c.req.param('orgId'), input, c.get('authSession'))

  return c.json(result)
})

orgRoutes.post('/:orgId/leave', requireMember, async (c) => {
  await leaveOrgController(c.req.param('orgId'), c.get('authSession'))

  return c.body(null, 204)
})

orgRoutes.post('/:orgId/transfer-ownership', requireOwner, async (c) => {
  const input = await parseBody(c, transferOwnershipSchema)
  const result = await transferOwnershipController(
    c.req.param('orgId'),
    input,
    c.get('authSession')
  )

  return c.json(result)
})

orgRoutes.get('/:orgId/members', requireMember, async (c) => {
  const result = await listMembersController(c.req.param('orgId'))

  return c.json(result)
})

orgRoutes.patch('/:orgId/members/:userId', requireOwner, async (c) => {
  const input = await parseBody(c, changeRoleSchema)
  const result = await changeRoleController(
    c.req.param('orgId'),
    c.req.param('userId'),
    input,
    c.get('authSession'),
    c.get('orgMembership')
  )

  return c.json(result)
})

orgRoutes.delete('/:orgId/members/:userId', requireAdmin, async (c) => {
  await removeMemberController(
    c.req.param('orgId'),
    c.req.param('userId'),
    c.get('authSession'),
    c.get('orgMembership')
  )

  return c.body(null, 204)
})

orgRoutes.post('/:orgId/invitations', requireAdmin, async (c) => {
  const input = await parseBody(c, createInvitationSchema)
  const result = await createInvitationController(
    c.req.param('orgId'),
    input,
    c.get('authSession'),
    c.get('orgMembership')
  )

  return c.json(result, 201)
})

orgRoutes.get('/:orgId/invitations', requireAdmin, async (c) => {
  const queryParsed = listInvitationsQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams)
  )

  if (!queryParsed.success) {
    throw new ValidationError('Invalid query', z.treeifyError(queryParsed.error))
  }

  const result = await listInvitationsController(c.req.param('orgId'), queryParsed.data)

  return c.json(result)
})

orgRoutes.delete('/:orgId/invitations/:invitationId', requireAdmin, async (c) => {
  await revokeInvitationController(
    c.req.param('orgId'),
    c.req.param('invitationId'),
    c.get('authSession')
  )

  return c.body(null, 204)
})

export const invitationRoutes = new Hono()

invitationRoutes.get('/:token', async (c) => {
  const result = await getInvitationController(c.req.param('token'))

  return c.json(result)
})

invitationRoutes.post('/:token/accept', requireSession, async (c) => {
  const result = await acceptInvitationController(c.req.param('token'), c.get('authSession'))

  return c.json(result)
})
