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
    new BullMQAdapter(getQueue(QueueName.outboxPublisher)),
    new BullMQAdapter(getQueue(QueueName.emails))
  ],
  serverAdapter
})

serverAdapter.setBasePath(BASE_PATH)

// The Bull Board plugin's Hono app. Mounted in app.ts with `requireStaff`
// applied at the outer `use()` level; we mount the plugin directly with
// `app.route('/api/admin/queues', queuesAdminPlugin)` rather than wrapping it
// in `new Hono().route('/', plugin)` — the extra layer adds no value and
// keeps the routing chain shallow.
//
// **Path conventions** — Bull Board renders the dashboard at
// `/api/admin/queues` (no trailing slash; that's the entry route Bull Board
// registers as `/`). Static assets live under `/static/*`, the JSON API under
// `/api/queues`, and queue / job detail pages under `/queue/...`. Bull
// Board's HTML emits `<base href="/api/admin/queues/">` so relative URLs in
// the bundle resolve correctly. Trailing-slash variants (e.g. someone pasting
// `/api/admin/queues/`) get a 301 from the `trimTrailingSlash` middleware
// registered in app.ts.
export const queuesAdminPlugin = serverAdapter.registerPlugin()
