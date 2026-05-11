import { on } from '@template/events'
import { logger } from '@/lib/logger.js'

// Logger-only subscriber. The email PR replaces this with a real handler
// that renders the invitation email and sends it via packages/email.
on('invitation.created', async (event) => {
  logger.info(
    {
      invitationId: event.invitationId,
      organisationId: event.organisationId,
      email: event.email,
      role: event.role
    },
    'invitation.created'
  )
})
