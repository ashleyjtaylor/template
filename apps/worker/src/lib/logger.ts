import { pino, stdSerializers } from 'pino'
import { env } from '@/env.js'

const baseOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'worker', release: env.GIT_SHA },
  serializers: { err: stdSerializers.err }
} satisfies Parameters<typeof pino>[0]

export const logger =
  env.NODE_ENV === 'development'
    ? pino({
        ...baseOptions,
        transport: { target: 'pino-pretty', options: { colorize: true } }
      })
    : pino(baseOptions)
