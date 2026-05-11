import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { HonoAdapter } from '@bull-board/hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { getQueue, QueueName } from '@template/events'

// Bull Board UI for the BullMQ queues this template ships with. Staff hit
// /api/admin/queues to inspect jobs, retry failures, and drill into payloads
// without SSH. New queues that forks add (e.g. emails, webhooks) should be
// appended to the queues list below so they show up in the dashboard.
//
// `/api/admin/*` is the namespace for staff-only operational tools, distinct
// from feature data routes like /api/audit-log.
export const BASE_PATH = '/api/admin/queues'

const serverAdapter = new HonoAdapter(serveStatic)

createBullBoard({
  queues: [
    new BullMQAdapter(getQueue(QueueName.internal)),
    new BullMQAdapter(getQueue(QueueName.schedules)),
    new BullMQAdapter(getQueue(QueueName.outboxPublisher))
  ],
  serverAdapter
})

serverAdapter.setBasePath(BASE_PATH)

// The Bull Board plugin Hono app. Mounted in app.ts with `requireStaff`
// applied at the outer `use()` level — wrapping it in an intermediate
// `new Hono().route('/', plugin)` triggers a Hono nested-routing bug where
// `/static/*` and the trailing-slash entry route don't match (the static UI
// assets 404 out, breaking the actual dashboard). Mounting directly avoids
// the double route() nesting and the plugin's routes resolve correctly.
export const queuesAdminPlugin = serverAdapter.registerPlugin()
