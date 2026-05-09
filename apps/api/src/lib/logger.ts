import { AsyncLocalStorage } from 'node:async_hooks'
import { pino, stdSerializers } from 'pino'
import { env } from '@/env.js'

export interface RequestContext {
  requestId: string
}

const als = new AsyncLocalStorage<RequestContext>()

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn)
}

export function getRequestId(): string | undefined {
  return als.getStore()?.requestId
}

const baseOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'api', release: env.GIT_SHA },
  serializers: { err: stdSerializers.err },
  mixin: () => {
    const requestId = getRequestId()

    return requestId ? { requestId } : {}
  }
} satisfies Parameters<typeof pino>[0]

export const logger =
  env.NODE_ENV === 'development'
    ? pino({
        ...baseOptions,
        transport: { target: 'pino-pretty', options: { colorize: true } }
      })
    : pino(baseOptions)
