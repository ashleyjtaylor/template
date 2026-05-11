import type { Prisma } from '@template/db'
import { id } from './ids.js'
import { getQueue } from './queue-store.js'
import { eventQueue } from './queues.js'
import type { DomainEvent } from './types.js'

export interface EmitOptions {
  // Pass a Prisma transaction client to write the event to the outbox table
  // inside the same transaction (so emit becomes atomic with the business
  // write). The outbox drainer enqueues to the destination queue after
  // commit. Without `tx`, emit enqueues directly to Redis.
  tx?: Prisma.TransactionClient
  // Optional request correlation id stamped on the outbox row.
  requestId?: string | null
}

/**
 * Publish a domain event. Routing to its destination queue is determined by
 * `eventQueue` (per-event-type). Subscribers register handlers via `on(...)`
 * in apps/worker; this function only knows about queues.
 *
 * - Inside a transaction (`{ tx }`): inserts an outbox row in the same
 *   transaction. The `outbox-publisher` repeatable job picks it up after commit.
 * - Outside a transaction: enqueues to the destination queue immediately.
 */
export async function emit(event: DomainEvent, options: EmitOptions = {}): Promise<void> {
  const targetQueue = eventQueue[event.type]

  if (options.tx) {
    await options.tx.outbox.create({
      data: {
        entityId: id('obx'),
        requestId: options.requestId ?? null,
        topic: event.type,
        payload: event as unknown as Prisma.InputJsonValue,
        targetQueue
      }
    })

    return
  }

  await getQueue(targetQueue).add(event.type, event)
}
