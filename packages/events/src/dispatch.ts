import { getHandlers } from './on.js'
import type { DomainEvent } from './types.js'

/**
 * Run every registered handler for an event. Called by the worker's BullMQ
 * job processor after a job is dequeued — the job's data is the serialised
 * event; dispatch() drives all subscribers.
 *
 * Errors propagate so BullMQ can mark the job failed and retry it.
 */
export async function dispatch(event: DomainEvent): Promise<void> {
  const registrations = getHandlers(event.type)
  for (const { handler } of registrations) await handler(event)
}
