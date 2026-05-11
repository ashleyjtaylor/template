import { ValidationError } from '@template/errors'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin, requireMember, requireOwner } from '@/middleware/require-org-role.js'
import { requireSession } from '@/middleware/require-session.js'
import {
  changeRoleController,
  createOrgController,
  getOrgController,
  leaveOrgController,
  listMembersController,
  listMyOrgsController,
  orgSignUpController,
  removeMemberController,
  transferOwnershipController,
  updateOrgController
} from '@/modules/organisations/controllers.js'
import {
  changeRoleSchema,
  createOrgSchema,
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
