import { parseArgs } from 'node:util'
import { prisma } from '@template/db'
import { auth } from '@/lib/auth.js'
import { logger } from '@/lib/logger.js'
import { isStaffRole, STAFF_ROLES, type StaffRole } from '@/middleware/require-staff.js'

class BootstrapError extends Error {}

const log = logger.child({ task: 'bootstrap-staff' })

// Inputs come from process.env first (production: ECS run-task env overrides
// from .github/workflows/bootstrap-staff.yml) then fall back to CLI flags
// (local: `pnpm bootstrap:staff --email=… --name="…" --password=… --role=…`).
const readInput = (envKey: string, cliValue: string | undefined): string | undefined =>
  process.env[envKey]?.trim() || cliValue?.trim() || undefined

const required = (envKey: string, cliValue: string | undefined, label: string): string => {
  const value = readInput(envKey, cliValue)

  if (!value)
    throw new BootstrapError(`${label} required (env ${envKey} or --${label.toLowerCase()})`)

  return value
}

const splitName = (full: string): { firstname: string; lastname: string } => {
  const parts = full.trim().split(/\s+/)
  const firstname = parts.shift() ?? full
  const lastname = parts.join(' ')

  return { firstname, lastname: lastname || firstname }
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' }
    },
    strict: false
  })

  const email = required('BOOTSTRAP_STAFF_EMAIL', values.email as string | undefined, 'Email')
  const name = required('BOOTSTRAP_STAFF_NAME', values.name as string | undefined, 'Name')
  const roleRaw = readInput('BOOTSTRAP_STAFF_ROLE', values.role as string | undefined) ?? 'admin'

  if (!isStaffRole(roleRaw)) {
    throw new BootstrapError(`role must be one of ${STAFF_ROLES.join('|')} (got "${roleRaw}")`)
  }

  const role: StaffRole = roleRaw
  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing) {
    if (existing.staffRole === role) {
      log.info({ email, role }, 'user already has target staffRole, no-op')
      return
    }

    await prisma.user.update({ where: { id: existing.id }, data: { staffRole: role } })
    log.info({ email, from: existing.staffRole, to: role }, 'updated staffRole')

    return
  }

  const password = required(
    'BOOTSTRAP_STAFF_PASSWORD',
    values.password as string | undefined,
    'Password'
  )
  const { firstname, lastname } = splitName(name)

  // signUpEmail handles password hashing via better-auth's configured hasher,
  // and runs the user.create.after hook (audit `user.signed_up`). Followed
  // by a direct prisma update because `staffRole` is `input: false` in
  // additionalFields — callers can't set it through the auth API.
  //
  // The body cast is because better-auth's generated input type still
  // surfaces shared `input: false` additionalFields (entityId, requestId)
  // as required at the type layer. They're stripped at runtime — the cast
  // matches the actual accepted shape.
  await auth.api.signUpEmail({
    body: { email, password, name, firstname, lastname }
  } as Parameters<typeof auth.api.signUpEmail>[0])
  await prisma.user.update({ where: { email }, data: { staffRole: role } })

  log.info({ email, role }, 'created staff user')
}

main()
  .catch((err) => {
    if (err instanceof BootstrapError) {
      log.error({ err: err.message }, 'invalid input')
    } else {
      log.error({ err }, 'bootstrap failed')
    }
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
