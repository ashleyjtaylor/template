import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { env } from './env.js'
import { errorHandler } from './middleware/error-handler.js'
import { healthReady } from './middleware/health-ready.js'
import { requestId } from './middleware/request-id.js'
import { requestLogger } from './middleware/request-logger.js'

export interface AppOptions {
  gitSha: string
  corsOrigins?: string[]
  bodyLimitBytes?: number
}

export function createApp({
  gitSha,
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

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      version: gitSha,
      uptime: Math.floor((Date.now() - startedAt) / 1000)
    })
  )

  app.get('/health/ready', healthReady)

  app.onError(errorHandler)

  return app
}
