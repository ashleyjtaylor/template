import { prisma } from '@template/db'
import { logger } from '@/lib/logger.js'
import { registerSchedule } from '@/lib/schedule-registry.js'

// Hourly housekeeping: hard-delete invitations that expired more than 30 days
// ago and were never accepted or revoked. Invitation status is derived from
// timestamps (no stored state column), so "expired" is implicit — this just
// trims stale rows.
export const CLEANUP_EXPIRED_INVITATIONS_SCHEDULE = {
  name: 'cleanup-expired-invitations',
  // Every hour, on the hour.
  pattern: '0 * * * *'
} as const

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

registerSchedule(CLEANUP_EXPIRED_INVITATIONS_SCHEDULE.name, async () => {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS)

  const result = await prisma.invitation.deleteMany({
    where: {
      expiresAt: { lt: cutoff },
      acceptedAt: null,
      revokedAt: null
    }
  })

  if (result.count > 0) {
    logger.info({ deleted: result.count, cutoff }, 'cleanup: removed expired invitations')
  }
})
