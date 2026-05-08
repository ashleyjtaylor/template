import { Hono } from 'hono'

export interface AppOptions {
  gitSha: string
}

export function createApp({ gitSha }: AppOptions) {
  const startedAt = Date.now()
  const app = new Hono()

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      version: gitSha,
      uptime: Math.floor((Date.now() - startedAt) / 1000)
    })
  )

  return app
}
