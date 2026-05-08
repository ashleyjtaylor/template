import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { env } from './env.js'

const app = createApp({ gitSha: env.GIT_SHA })

serve({ fetch: app.fetch, port: env.PORT })
