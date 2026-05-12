import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { trimTrailingSlash } from 'hono/trailing-slash'
import { env } from '@/env.js'
import { auth } from '@/lib/auth.js'
import { errorHandler } from '@/middleware/error-handler.js'
import { healthReady } from '@/middleware/health-ready.js'
import { requestId } from '@/middleware/request-id.js'
import { requestLogger } from '@/middleware/request-logger.js'
import { requireStaff } from '@/middleware/require-staff.js'
import { queuesAdminPlugin } from '@/modules/admin/queues.js'
import { sentEmailsAdminRoutes } from '@/modules/admin/sent-emails/routes.js'
import { auditLogRoutes } from '@/modules/audit-log/routes.js'
import { billingRoutes } from '@/modules/billing/routes.js'
import { orgInvitationAcceptRoutes, orgInvitationRoutes } from '@/modules/org-invitations/routes.js'
import { orgRoutes } from '@/modules/organisations/routes.js'
import { stripeWebhookRoutes } from '@/modules/webhooks/stripe.js'

export interface AppOptions {
  gitSha: string
  appEnv: 'local' | 'staging' | 'production'
  corsOrigins?: string[]
  bodyLimitBytes?: number
}

export function createApp({
  gitSha,
  appEnv,
  corsOrigins = env.CORS_ORIGINS,
  bodyLimitBytes = env.BODY_LIMIT_BYTES
}: AppOptions) {
  const startedAt = Date.now()
  const app = new Hono()

  app.use('*', requestId())
  app.use('*', requestLogger())
  app.use('*', secureHeaders())
  app.use('*', cors({ origin: corsOrigins }))
  app.use('*', bodyLimit({ maxSize: bodyLimitBytes }))
  // Default behaviour: only redirects on 404 — normal routes are unaffected.
  // Without this, requests with a trailing slash (e.g. `/api/admin/queues/`)
  // 404 because Hono treats them as distinct routes from their no-slash
  // counterparts. The redirect normalises to the canonical no-slash variant.
  app.use('*', trimTrailingSlash())

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      version: gitSha,
      env: appEnv,
      uptime: Math.floor((Date.now() - startedAt) / 1000)
    })
  )

  app.get('/health/ready', healthReady)

  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  app.use('/api/admin/queues/*', requireStaff)
  app.use('/api/admin/queues', requireStaff)
  app.route('/api/admin/queues', queuesAdminPlugin)
  app.route('/api/admin/sent-emails', sentEmailsAdminRoutes)
  app.route('/api/audit-log', auditLogRoutes)
  app.route('/api/orgs', orgRoutes)
  app.route('/api/orgs', billingRoutes)
  app.route('/api/orgs/:orgId/invitations', orgInvitationRoutes)
  app.route('/api/invitations', orgInvitationAcceptRoutes)
  // Stripe webhook — no auth (signature verification inside the handler).
  // Mounted last so prior /api/orgs routes don't shadow it; in practice
  // /api/webhooks/* doesn't collide with anything but order is cheap
  // insurance.
  app.route('/api/webhooks', stripeWebhookRoutes)

  app.onError(errorHandler)

  return app
}
