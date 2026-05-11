import { Redis } from 'ioredis'
import { env } from './env.js'

// Shared IORedis instance for all BullMQ Queue and Worker handles in this
// process. BullMQ requires `maxRetriesPerRequest: null` for blocking commands.
let connection: Redis | undefined

export function getRedis(): Redis {
  if (!connection) {
    connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
  }

  // biome-ignore lint/style/noNonNullAssertion: assigned in the if-block above
  return connection!
}

export async function disconnectRedis(): Promise<void> {
  if (!connection) return
  await connection.quit()
  connection = undefined
}
