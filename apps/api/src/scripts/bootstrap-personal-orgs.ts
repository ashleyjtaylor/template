import { prisma } from '@template/db'
import { logger } from '@/lib/logger.js'
import { createOrg } from '@/modules/organisations/service.js'

// One-off backfill — finds users without any membership and creates a
// personal organisation for each. Idempotent: re-running is a no-op
// because the query filters out anyone who already has a membership.
//
// Local: `pnpm --filter @template/api bootstrap:personal-orgs`
// Deployed (post-billing-launch): same shape as `bootstrap-staff` —
// a `workflow_dispatch`-only GitHub Action invokes `aws ecs run-task`
// against a dedicated task definition.

const log = logger.child({ task: 'bootstrap-personal-orgs' })

async function main() {
  const users = await prisma.user.findMany({
    where: { memberships: { none: {} } },
    select: { id: true, entityId: true, firstname: true, lastname: true, email: true }
  })

  if (users.length === 0) {
    log.info('every user already has at least one membership — nothing to do')

    return
  }

  log.info({ count: users.length }, 'creating personal organisations')

  for (const user of users) {
    const firstname = user.firstname.trim() || user.email.split('@')[0] || 'Personal'
    const name = `${firstname}'s workspace`

    const { organisation } = await createOrg(name, user.id, user.entityId)

    log.info(
      { userEntityId: user.entityId, email: user.email, organisationId: organisation.entityId },
      'personal org created'
    )
  }

  log.info({ count: users.length }, 'done')
}

main()
  .catch((err) => {
    log.error({ err }, 'bootstrap-personal-orgs failed')
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
