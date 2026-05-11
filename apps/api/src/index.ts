import { serve } from '@hono/node-server'
import { prisma } from '@template/db'
import { createApp } from '@/app.js'
import { env } from '@/env.js'
import { logger } from '@/lib/logger.js'
import { registerShutdown } from '@/lib/shutdown.js'

const app = createApp({ gitSha: env.GIT_SHA, appEnv: env.APP_ENV })

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, 'api listening')
})

registerShutdown(server, {
  timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
  beforeExit: [() => prisma.$disconnect()]
})
