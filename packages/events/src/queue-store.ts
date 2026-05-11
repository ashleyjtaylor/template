import { Queue } from 'bullmq'
import { getRedis } from './connection.js'
import type { QueueName } from './queues.js'

// Lazily-instantiated map of named queues. One Queue per name per process.
// Producers (api) call getQueue() to enqueue; workers also consume from these
// names via BullMQ Worker instances (created in apps/worker).
const queues = new Map<QueueName, Queue>()

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name)
  if (existing) return existing

  const queue = new Queue(name, { connection: getRedis() })
  queues.set(name, queue)

  return queue
}

export async function closeQueues(): Promise<void> {
  for (const q of queues.values()) await q.close()
  queues.clear()
}
