import { env } from './env.js'
import { LogOnlySender } from './transports/log-only.js'
import { MailpitSender } from './transports/mailpit.js'
import { SesSender } from './transports/ses.js'
import type { EmailTransport } from './types.js'

// Single source of truth for which transport `sendEmail` uses. Wired off
// APP_ENV (single switch for any local-service substitute, per the
// template's convention) + the presence of EMAIL_FROM as the signal that
// SES is configured for this fork's environment.
//
// - APP_ENV=local            → MailpitSender (docker-compose service)
// - else and EMAIL_FROM set  → SesSender (real SES via task-role IAM)
// - else                     → LogOnlySender (deploy works without SES)
let cached: EmailTransport | undefined

export function getTransport(): EmailTransport {
  if (cached) return cached

  if (env.APP_ENV === 'local') cached = new MailpitSender()
  else if (env.EMAIL_FROM) cached = new SesSender()
  else cached = new LogOnlySender()

  return cached
}

// Test seam. Lets specs swap in a recording transport.
export function setTransport(transport: EmailTransport): void {
  cached = transport
}

export function resetTransport(): void {
  cached = undefined
}
