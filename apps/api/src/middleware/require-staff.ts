import { createMiddleware } from 'hono/factory'
import { auth } from '@/lib/auth.js'
import { ForbiddenError, UnauthorizedError } from '@/lib/errors.js'

// `staffRole` is `string | null` from better-auth's `additionalFields` (it
// only supports plain `string` types, not unions). The narrowing to
// `'support' | 'engineer' | 'admin'` happens here so callers downstream
// can rely on a typed value.
export type StaffRole = 'support' | 'engineer' | 'admin'

export interface StaffSession {
  user: {
    id: string
    entityId: string
    email: string
    staffRole: StaffRole
  }
  session: {
    id: string
    entityId: string
    token: string
    userId: string
  }
}

export const STAFF_ROLES = ['support', 'engineer', 'admin'] as const satisfies readonly StaffRole[]

export const isStaffRole = (value: unknown): value is StaffRole =>
  typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value)

// Pure resolver: throws UnauthorizedError (401) if no session,
// ForbiddenError (403) if the session's user has no valid staff role.
const getStaffSession = async (headers: Headers): Promise<StaffSession> => {
  const result = await auth.api.getSession({ headers })

  if (!result) throw new UnauthorizedError('Authentication required')

  const user = result.user as {
    id: string
    entityId: string
    email: string
    staffRole?: string | null
  }

  if (!isStaffRole(user.staffRole)) throw new ForbiddenError('Staff access required')

  return {
    user: {
      id: user.id,
      entityId: user.entityId,
      email: user.email,
      staffRole: user.staffRole
    },
    session: result.session as StaffSession['session']
  }
}

// Hono middleware. Apply at the route or route-group level via `.use()`. Sets
// the resolved staff session on the context as `staffSession` so handlers can
// access it via `c.get('staffSession')` when needed.
export const requireStaff = createMiddleware<{ Variables: { staffSession: StaffSession } }>(
  async (c, next) => {
    const session = await getStaffSession(c.req.raw.headers)

    c.set('staffSession', session)

    await next()
  }
)
