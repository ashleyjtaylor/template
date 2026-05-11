import type { DomainEvent } from './types.js'

type Handler<T extends DomainEvent['type']> = (
  event: Extract<DomainEvent, { type: T }>
) => Promise<void>

interface Registration {
  handler: (event: DomainEvent) => Promise<void>
}

// Process-local handler registry. Worker boot files import the subscribers
// directory, which registers handlers here; the Worker's job processor then
// looks up by event type and runs them.
const handlers = new Map<DomainEvent['type'], Registration[]>()

/**
 * Register a handler for a domain event. Called from apps/worker/src/subscribers/
 * at boot. Multiple handlers per event type are allowed and all run when the
 * event is dispatched.
 */
export function on<T extends DomainEvent['type']>(type: T, handler: Handler<T>): void {
  const existing = handlers.get(type) ?? []
  existing.push({ handler: handler as Registration['handler'] })
  handlers.set(type, existing)
}

export function getHandlers(type: DomainEvent['type']): Registration[] {
  return handlers.get(type) ?? []
}

export function clearHandlers(): void {
  handlers.clear()
}
