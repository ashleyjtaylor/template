import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ClosableServer, registerShutdown } from '@/lib/shutdown.js'

describe('registerShutdown', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let unregister: () => void = () => {}

  beforeEach(() => {
    // Don't throw from the spy — the close callback is async, so a synchronous
    // throw would propagate out of an async chain in confusing ways. Tests
    // wait for the spy via vi.waitFor instead.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    unregister()
    exitSpy.mockRestore()
    vi.useRealTimers()
  })

  it('should call server.close on SIGTERM and exit 0 when drain succeeds', async () => {
    const close = vi.fn((cb?: (err?: Error) => void) => cb?.())
    const server: ClosableServer = { close }

    unregister = registerShutdown(server, { timeoutMs: 1000 })
    process.emit('SIGTERM')

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0)
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('should run beforeExit hooks after the server drains', async () => {
    const close = vi.fn((cb?: (err?: Error) => void) => cb?.())
    const hook = vi.fn(() => Promise.resolve())
    const server: ClosableServer = { close }

    unregister = registerShutdown(server, { timeoutMs: 1000, beforeExit: [hook] })
    process.emit('SIGTERM')

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0)
    })
    expect(hook).toHaveBeenCalledOnce()
  })

  it('should exit 0 after the timeout when close hangs', async () => {
    vi.useFakeTimers()
    const close = vi.fn() // never invokes its callback
    const server: ClosableServer = { close }

    unregister = registerShutdown(server, { timeoutMs: 100 })
    process.emit('SIGTERM')
    await vi.advanceTimersByTimeAsync(100)

    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('should exit 1 when server.close errors', async () => {
    const close = vi.fn((cb?: (err?: Error) => void) => cb?.(new Error('boom')))
    const server: ClosableServer = { close }

    unregister = registerShutdown(server, { timeoutMs: 1000 })
    process.emit('SIGTERM')

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  it('should ignore a second signal once shutdown is in progress', async () => {
    const close = vi.fn((cb?: (err?: Error) => void) => cb?.())
    const server: ClosableServer = { close }

    unregister = registerShutdown(server, { timeoutMs: 1000 })
    process.emit('SIGTERM')

    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1)
    })

    process.emit('SIGTERM')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
