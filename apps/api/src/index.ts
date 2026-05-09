import { serve } from '@hono/node-server'
import { createApp } from '@/app.js'
import { env } from '@/env.js'
import { prisma } from '@/lib/db.js'
import { logger } from '@/lib/logger.js'
import { registerShutdown } from '@/lib/shutdown.js'

const app = createApp({ gitSha: env.GIT_SHA })

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, 'api listening')
})

registerShutdown(server, {
  timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
  beforeExit: [() => prisma.$disconnect()]
})
