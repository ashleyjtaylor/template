import { pino } from 'pino'

// Lightweight logger for transport-level activity. Apps that wrap
// `packages/email` can also log at their level — this is just for the
// transport's own diagnostic output (LogOnlySender's full-payload dump,
// SES MessageId, Mailpit message id).
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: { service: 'email', release: process.env['GIT_SHA'] ?? 'unknown' }
})
