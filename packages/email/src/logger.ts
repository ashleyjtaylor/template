import { pino } from 'pino'
import { env } from './env.js'

// Lightweight logger for transport-level activity. Apps that wrap
// `packages/email` can also log at their level — this is just for the
// transport's own diagnostic output (LogOnlySender's full-payload dump,
// SES MessageId, Mailpit message id).
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'email', release: env.GIT_SHA }
})
