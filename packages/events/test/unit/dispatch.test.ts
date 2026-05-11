import { afterEach, describe, expect, it } from 'vitest'
import { clearHandlers, dispatch, on } from '../../src/index.js'

afterEach(() => {
  clearHandlers()
})

describe('on + dispatch', () => {
  it('runs every registered handler for an event type', async () => {
    const calls: string[] = []
    on('worker.heartbeat', async (event) => {
      calls.push(`a:${event.ts}`)
    })
    on('worker.heartbeat', async (event) => {
      calls.push(`b:${event.ts}`)
    })

    await dispatch({ type: 'worker.heartbeat', ts: '2026-01-01T00:00:00Z' })

    expect(calls).toEqual(['a:2026-01-01T00:00:00Z', 'b:2026-01-01T00:00:00Z'])
  })

  it('only runs handlers for the matching event type', async () => {
    const calls: string[] = []
    on('worker.heartbeat', async () => {
      calls.push('heartbeat')
    })
    on('invitation.created', async () => {
      calls.push('invitation')
    })

    await dispatch({ type: 'worker.heartbeat', ts: 'x' })

    expect(calls).toEqual(['heartbeat'])
  })

  it('is a noop when no handlers are registered', async () => {
    await expect(dispatch({ type: 'worker.heartbeat', ts: 'x' })).resolves.toBeUndefined()
  })

  it('propagates handler errors so BullMQ can mark the job failed', async () => {
    on('worker.heartbeat', async () => {
      throw new Error('boom')
    })

    await expect(dispatch({ type: 'worker.heartbeat', ts: 'x' })).rejects.toThrow('boom')
  })
})
