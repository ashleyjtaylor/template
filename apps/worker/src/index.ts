import { prisma } from '@template/db'
import {
  closeQueues,
  disconnectRedis,
  dispatch,
  getQueue,
  getRedis,
  publishOutbox,
  QueueName
} from '@template/events'
import { Worker } from 'bullmq'
import { env } from '@/env.js'
import { logger } from '@/lib/logger.js'
import { getScheduleHandler } from '@/lib/schedule-registry.js'
import { registerShutdown } from '@/lib/shutdown.js'

// Import side-effect-only: each module calls events.on(...) or
// registerSchedule(...) at import time. Order doesn't matter; all
// registrations complete before the Worker instances start processing.
import '@/subscribers/heartbeat.js'
import '@/subscribers/invitation-created.js'
import { CLEANUP_EXPIRED_INVITATIONS_SCHEDULE } from '@/schedules/cleanup-expired-invitations.js'
import { HEARTBEAT_SCHEDULE } from '@/schedules/heartbeat.js'

async function main() {
  logger.info({ env: env.APP_ENV, gitSha: env.GIT_SHA, nodeEnv: env.NODE_ENV }, 'worker: starting')

  const connection = getRedis()

  // Worker for the `internal` queue: processes domain events fan-out style.
  // Job data is the serialised DomainEvent; dispatch() runs every registered
  // handler.
  const internalWorker = new Worker(
    QueueName.internal,
    async (job) => {
      logger.info({ name: job.name, id: job.id }, 'event: processing')
      await dispatch(job.data)
    },
    { connection, concurrency: env.WORKER_QUEUE_INTERNAL_CONCURRENCY }
  )

  // Worker for the `schedules` queue: dispatches by job.name → handler from
  // the schedule registry. Each repeatable job uses its schedule's name as
  // the job name.
  const schedulesWorker = new Worker(
    QueueName.schedules,
    async (job) => {
      const handler = getScheduleHandler(job.name)
      if (!handler) {
        logger.warn({ name: job.name }, 'schedule: no handler registered')
        return
      }

      logger.info({ name: job.name }, 'schedule: firing')
      await handler()
    },
    { connection, concurrency: env.WORKER_QUEUE_SCHEDULES_CONCURRENCY }
  )

  // Worker for the `outbox-publisher` queue: one job per tick, calls publishOutbox.
  // Concurrency 1 keeps it singleton so two ticks can't race on the same row.
  const outboxPublisherWorker = new Worker(
    QueueName.outboxPublisher,
    async () => {
      const result = await publishOutbox()
      if (result.published > 0 || result.failed > 0) {
        logger.info({ ...result }, 'outbox: tick')
      }
    },
    { connection, concurrency: 1 }
  )

  // Register repeatable jobs. Re-running with the same job name + repeat
  // options is idempotent — BullMQ dedupes by the repeat key.
  const schedules = getQueue(QueueName.schedules)
  await schedules.add(
    HEARTBEAT_SCHEDULE.name,
    {},
    { repeat: { every: HEARTBEAT_SCHEDULE.every }, jobId: HEARTBEAT_SCHEDULE.name }
  )
  await schedules.add(
    CLEANUP_EXPIRED_INVITATIONS_SCHEDULE.name,
    {},
    {
      repeat: { pattern: CLEANUP_EXPIRED_INVITATIONS_SCHEDULE.pattern },
      jobId: CLEANUP_EXPIRED_INVITATIONS_SCHEDULE.name
    }
  )

  const outboxQueue = getQueue(QueueName.outboxPublisher)
  await outboxQueue.add(
    'publish',
    {},
    { repeat: { every: env.OUTBOX_PUBLISHER_INTERVAL_MS }, jobId: 'publish' }
  )

  registerShutdown({
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    beforeExit: [
      async () => {
        logger.info('shutdown: closing BullMQ Workers')
        await Promise.all([
          internalWorker.close(),
          schedulesWorker.close(),
          outboxPublisherWorker.close()
        ])
      },
      async () => {
        logger.info('shutdown: closing BullMQ Queues')
        await closeQueues()
      },
      async () => {
        logger.info('shutdown: disconnecting Redis')
        await disconnectRedis()
      },
      async () => {
        logger.info('shutdown: disconnecting Prisma')
        await prisma.$disconnect()
      }
    ]
  })

  logger.info('worker: ready')
}

main().catch((err) => {
  logger.error({ err }, 'worker: fatal error during boot')
  process.exit(1)
})
