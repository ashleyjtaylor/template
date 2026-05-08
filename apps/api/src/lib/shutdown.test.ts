import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ClosableServer, registerShutdown } from './shutdown.js'

describe('registerShutdown', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let unregister: () => void = () => {}

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('__exit__')
    }) as never)
  })

  afterEach(() => {
    unregister()
    exitSpy.mockRestore()
    vi.useRealTimers()
  })

  it('should call server.close on SIGTERM and exit 0 when drain succeeds', () => {
    const close = vi.fn((cb?: (err?: Error) => void) => cb?.())
    const server: ClosableServer = { close }

    unregister = registerShutdown(server, { timeoutMs: 1000 })

    expect(() => process.emit('SIGTERM')).toThrow('__exit__')
    expect(close).toHaveBeenCalledOnce()
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('should exit 0 after the timeout when close hangs', () => {
    vi.useFakeTimers()
    const close = vi.fn() // never invokes its callback
    const server: ClosableServer = { close }

    unregister = registerShutdown(server, { timeoutMs: 100 })
    process.emit('SIGTERM')

    expect(() => vi.advanceTimersByTime(100)).toThrow('__exit__')
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('should exit 1 when server.close errors', () => {
    const close = vi.fn((cb?: (err?: Error) => void) => cb?.(new Error('boom')))
    const server: ClosableServer = { close }

    unregister = registerShutdown(server, { timeoutMs: 1000 })

    expect(() => process.emit('SIGTERM')).toThrow('__exit__')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should ignore a second signal once shutdown is in progress', () => {
    const close = vi.fn((cb?: (err?: Error) => void) => cb?.())
    const server: ClosableServer = { close }

    unregister = registerShutdown(server, { timeoutMs: 1000 })

    expect(() => process.emit('SIGTERM')).toThrow('__exit__')
    expect(close).toHaveBeenCalledTimes(1)

    expect(() => process.emit('SIGTERM')).not.toThrow()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
