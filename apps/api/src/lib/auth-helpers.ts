import type { Context } from 'hono'
import { auth } from '@/lib/auth.js'
import { ForbiddenError, UnauthorizedError } from '@/lib/errors.js'

// `staffRole` is `string | null` from better-auth's `additionalFields` (it
// only supports plain `string` types, not unions). The narrowing to
// `'support' | 'engineer' | 'admin'` happens here at the helper layer so
// callers can rely on a typed value.
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

interface RawSessionUser {
  id: string
  entityId: string
  email: string
  staffRole?: string | null
}

const STAFF_ROLES: ReadonlySet<StaffRole> = new Set(['support', 'engineer', 'admin'])

const isStaffRole = (value: unknown): value is StaffRole =>
  typeof value === 'string' && STAFF_ROLES.has(value as StaffRole)

// Throws UnauthorizedError (401) if no session, ForbiddenError (403) if the
// session's user has no staff role. Single source of truth for "is staff" is
// the `staffRole` column on User.
export async function requireStaff(c: Context): Promise<StaffSession> {
  const result = await auth.api.getSession({ headers: c.req.raw.headers })

  if (!result) throw new UnauthorizedError('Authentication required')

  const user = result.user as RawSessionUser

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
