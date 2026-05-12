import { logger } from '../logger.js'
import type { EmailTransport, SendEmailParams, TransportResult } from '../types.js'

// Stub transport used when SES isn't wired (no EMAIL_FROM) and we're not on
// local. Writes the rendered email to the structured log so the deploy
// pipeline doesn't fail just because email isn't configured for the fork
// yet. The `sent_emails` row still lands with status='sent' — operationally
// useful for confirming the path works end-to-end before SES is hooked up.
export class LogOnlySender implements EmailTransport {
  async send(params: SendEmailParams & { from: string }): Promise<TransportResult> {
    logger.info(
      {
        from: params.from,
        to: params.to,
        subject: params.subject,
        template: params.template,
        dedupeKey: params.dedupeKey,
        // The body itself is intentionally NOT logged at info — it can be
        // large and contains the rendered link. Debug-level for retrieval
        // when needed.
        bodyLength: params.html.length
      },
      'email: log-only (would send)'
    )
    logger.debug({ html: params.html, text: params.text }, 'email: log-only body')

    return { messageId: null }
  }
}
