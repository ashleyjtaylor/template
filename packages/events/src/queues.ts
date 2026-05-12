import type { DomainEvent } from './types.js'

// Named BullMQ queues this template ships with. Forks add per-feature queues
// (e.g. `webhooks`) here when those features land.
export const QueueName = {
  internal: 'internal',
  outboxPublisher: 'outbox-publisher',
  schedules: 'schedules',
  emails: 'emails'
} as const

export type QueueName = (typeof QueueName)[keyof typeof QueueName]

// Maps each DomainEvent type to its target BullMQ queue. emit() looks this up
// and enqueues accordingly. Forks add entries when they extend DomainEvent.
export const eventQueue = {
  'worker.heartbeat': QueueName.internal,
  'invitation.created': QueueName.emails
} as const satisfies Record<DomainEvent['type'], QueueName>
