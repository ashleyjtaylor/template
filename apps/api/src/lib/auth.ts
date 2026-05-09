import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { env } from '@/env.js'
import { writeAudit } from '@/lib/audit.js'
import { prisma } from '@/lib/db.js'
import { getRequestId } from '@/lib/logger.js'

const entityId = (prefix: string) => () => `${prefix}${crypto.randomUUID()}`

// Additional fields beyond better-auth's built-in schema. The Prisma adapter
// strips fields not declared here before insert, so `entityId` must be
// registered via additionalFields (with `input: false` so it can't be set
// by callers) — a databaseHooks injection alone gets stripped.
const sharedEntityIdField = (prefix: string) => ({
  type: 'string' as const,
  required: true,
  input: false,
  defaultValue: entityId(prefix)
})

// Captures the X-Request-Id of the HTTP request that created the row, read
// from the AsyncLocalStorage context seeded by middleware/request-id.ts.
// Out-of-request inserts (seed scripts, future jobs) leave it null.
const sharedRequestIdField = {
  type: 'string' as const,
  required: false,
  input: false,
  defaultValue: () => getRequestId() ?? null
}

// better-auth's hook params don't carry our additionalFields in their types.
// Narrow once at the call site instead of bracket-accessing throughout.
type UserCreatePayload = { name?: string | null; firstname?: string; lastname?: string }
type UserCreatedPayload = {
  entityId: string
  email: string
  firstname?: string
  lastname?: string
}
type SessionPayload = { userId: string }

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/auth',
  trustedOrigins: env.CORS_ORIGINS,
  emailAndPassword: {
    enabled: true
  },
  user: {
    additionalFields: {
      firstname: { type: 'string', required: true, input: true },
      lastname: { type: 'string', required: true, input: true },
      entityId: sharedEntityIdField('usr_'),
      requestId: sharedRequestIdField
    }
  },
  session: {
    additionalFields: {
      entityId: sharedEntityIdField('sess_'),
      requestId: sharedRequestIdField
    }
  },
  account: {
    additionalFields: {
      entityId: sharedEntityIdField('acct_'),
      requestId: sharedRequestIdField
    }
  },
  verification: {
    additionalFields: {
      entityId: sharedEntityIdField('veri_'),
      requestId: sharedRequestIdField
    }
  },
  // better-auth's signup body still requires `name`. The hook composes it from
  // firstname+lastname when missing so the column is always populated, even if
  // a future caller sends only first/last.
  // Auth events are emitted via after-hooks. Signup yields TWO events
  // (`user.signed_up` from user.create.after AND `user.logged_in` from
  // session.create.after) — semantically correct (user signed up AND was
  // logged in) and avoids fragile differentiation logic. See `audit` skill.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const { name, firstname, lastname } = user as UserCreatePayload
          if (name) return undefined
          return {
            data: {
              ...user,
              name: `${firstname ?? ''} ${lastname ?? ''}`.trim()
            }
          }
        },
        after: async (user) => {
          const u = user as unknown as UserCreatedPayload
          await writeAudit({
            action: 'user.signed_up',
            actorUserId: u.entityId,
            email: u.email,
            firstname: u.firstname ?? '',
            lastname: u.lastname ?? ''
          })
        }
      }
    },
    session: {
      create: {
        after: async (session) => {
          const { userId } = session as SessionPayload
          const user = await prisma.user.findUnique({ where: { id: userId } })
          if (!user) return
          await writeAudit({ action: 'user.logged_in', actorUserId: user.entityId })
        }
      },
      delete: {
        after: async (session) => {
          const { userId } = session as SessionPayload
          const user = await prisma.user.findUnique({ where: { id: userId } })
          if (!user) return
          await writeAudit({ action: 'user.logged_out', actorUserId: user.entityId })
        }
      }
    }
  }
})
