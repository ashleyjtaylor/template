import { prisma } from '@template/db'
import { sendEmail } from '@template/email'
import { invitationEmail } from '@template/emails'
import { NotFoundError } from '@template/errors'
import { on } from '@template/events'
import { env } from '@/env.js'
import { logger } from '@/lib/logger.js'

// Renders the invitation email and hands it to packages/email. Dedupe key
// is keyed on the invitation id — BullMQ retries after a successful send
// hit the `sent_emails.sent_at` short-circuit inside sendEmail and no-op.
on('invitation.created', async (event) => {
  const invitation = await prisma.invitation.findUnique({
    where: { entityId: event.invitationId },
    include: { invitedBy: true, organisation: true }
  })

  if (!invitation) {
    // Invitation was deleted between event emit and handler run. Nothing
    // useful to do — log and let BullMQ mark the job done.
    logger.warn(
      { invitationId: event.invitationId },
      'invitation.created: invitation not found, skipping email'
    )
    throw new NotFoundError('invitation not found')
  }

  const inviter = invitation.invitedBy
  const inviterName =
    [inviter.firstname, inviter.lastname].filter(Boolean).join(' ').trim() || inviter.email
  const acceptUrl = `${env.WEB_BASE_URL}/accept-invite?token=${encodeURIComponent(event.rawToken)}`

  const envelope = await invitationEmail({
    inviterName,
    orgName: invitation.organisation.name,
    acceptUrl
  })

  await sendEmail({
    to: event.email,
    dedupeKey: `invitation:${event.invitationId}`,
    requestId: invitation.requestId ?? null,
    ...envelope
  })
})
