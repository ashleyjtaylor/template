import { prisma } from '@template/db'
import { getQueue } from './queue-store.js'
import type { QueueName } from './queues.js'

// Bounded batch size per drain tick. Keeps individual iterations short so the
// 1s repeatable cadence stays predictable and the failure blast radius is
// limited.
const BATCH = 100

/**
 * Pull unprocessed outbox rows in created_at order and enqueue each to its
 * recorded `target_queue`. Marks rows processed on success; on failure,
 * increments `attempts` and stores `last_error` for the next tick to retry.
 *
 * Called by the worker's repeatable `outbox-drain` job (cadence configured at
 * registration time in apps/worker).
 */
export async function drainOutbox(): Promise<{ drained: number; failed: number }> {
  const rows = await prisma.outbox.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: 'asc' },
    take: BATCH
  })

  let drained = 0
  let failed = 0

  for (const row of rows) {
    try {
      await getQueue(row.targetQueue as QueueName).add(row.topic, row.payload)
      await prisma.outbox.update({
        where: { entityId: row.entityId },
        data: { processedAt: new Date() }
      })
      drained++
    } catch (err) {
      await prisma.outbox.update({
        where: { entityId: row.entityId },
        data: {
          attempts: { increment: 1 },
          lastError: err instanceof Error ? err.message : String(err)
        }
      })
      failed++
    }
  }

  return { drained, failed }
}
