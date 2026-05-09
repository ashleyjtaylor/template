import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { env } from '@/env.js'
import { prisma } from '@/lib/db.js'

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

// better-auth's user.create.before hook param doesn't carry our additionalFields
// in its type. Narrow once at the call site instead of bracket-accessing.
type UserCreatePayload = { name?: string | null; firstname?: string; lastname?: string }

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  basePath: '/auth',
  trustedOrigins: env.CORS_ORIGINS,
  emailAndPassword: {
    enabled: true
  },
  user: {
    additionalFields: {
      firstname: { type: 'string', required: true, input: true },
      lastname: { type: 'string', required: true, input: true },
      entityId: sharedEntityIdField('usr_')
    }
  },
  session: {
    additionalFields: {
      entityId: sharedEntityIdField('sess_')
    }
  },
  account: {
    additionalFields: {
      entityId: sharedEntityIdField('acct_')
    }
  },
  verification: {
    additionalFields: {
      entityId: sharedEntityIdField('veri_')
    }
  },
  // better-auth's signup body still requires `name`. The hook composes it from
  // firstname+lastname when missing so the column is always populated, even if
  // a future caller sends only first/last.
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
        }
      }
    }
  }
})
