import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { HonoAdapter } from '@bull-board/hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { getQueue, QueueName } from '@template/events'
import { Hono } from 'hono'
import { requireStaff } from '@/middleware/require-staff.js'

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

export const queuesAdminRoutes = new Hono()
queuesAdminRoutes.use('*', requireStaff)
queuesAdminRoutes.route('/', serverAdapter.registerPlugin())
