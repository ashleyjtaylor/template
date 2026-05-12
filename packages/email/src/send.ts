import { prisma } from '@template/db'
import { InternalError, ValidationError } from '@template/errors'
import { env } from './env.js'
import { id } from './ids.js'
import { logger } from './logger.js'
import { getTransport } from './transport-selector.js'
import type { SendEmailParams } from './types.js'

// Local Mailpit accepts any From address. Used as the default so workers
// can call sendEmail without per-env setup just to render a sender.
const LOCAL_DEFAULT_FROM = 'noreply@local.test'

function resolveFrom(): string {
  if (env.EMAIL_FROM) return env.EMAIL_FROM

  if (env.APP_ENV === 'local') return LOCAL_DEFAULT_FROM

  // Deployed envs without EMAIL_FROM still call sendEmail (LogOnlySender)
  // — set a sentinel so log lines + sent_emails rows record a "from".
  return 'unset@example.invalid'
}

/**
 * Send an email. Records the attempt in `sent_emails` with `dedupe_key` as
 * the idempotency anchor — re-runs of the same logical send are a no-op
 * once `sent_at` is populated.
 *
 * Errors from the transport propagate. The `sent_emails` row is updated
 * to `status='failed'` with `last_error` before re-throwing, so a BullMQ
 * retry sees the previous attempt's state.
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  if (!params.dedupeKey) throw new ValidationError('dedupeKey is required')

  const from = resolveFrom()

  // Upsert a pending row. If a `sent_at` already exists, we're a retry
  // after success — short-circuit. Otherwise we either land a fresh
  // `pending` row or pick up an existing pending/failed row to retry.
  const existing = await prisma.sentEmail.findUnique({
    where: { dedupeKey: params.dedupeKey }
  })

  if (existing?.sentAt) {
    logger.info(
      { dedupeKey: params.dedupeKey, sentAt: existing.sentAt, messageId: existing.messageId },
      'email: skipped (already sent)'
    )

    return
  }

  const row = existing
    ? existing
    : await prisma.sentEmail.create({
        data: {
          entityId: id('sem'),
          requestId: params.requestId ?? null,
          dedupeKey: params.dedupeKey,
          recipient: params.to,
          template: params.template,
          subject: params.subject,
          html: params.html,
          text: params.text ?? null,
          status: 'pending'
        }
      })

  try {
    const { messageId } = await getTransport().send({ ...params, from })

    await prisma.sentEmail.update({
      where: { entityId: row.entityId },
      data: {
        status: 'sent',
        sentAt: new Date(),
        messageId: messageId ?? null,
        lastError: null
      }
    })

    logger.info(
      { dedupeKey: params.dedupeKey, template: params.template, to: params.to, messageId },
      'email: sent'
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    await prisma.sentEmail.update({
      where: { entityId: row.entityId },
      data: { status: 'failed', lastError: message }
    })

    logger.error(
      { dedupeKey: params.dedupeKey, template: params.template, to: params.to, err: message },
      'email: send failed'
    )

    throw new InternalError('email send failed', { dedupeKey: params.dedupeKey, cause: message })
  }
}
