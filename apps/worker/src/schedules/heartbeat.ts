import { emit } from '@template/events'
import { registerSchedule } from '@/lib/schedule-registry.js'

// Periodic proof-of-life. Emits a `worker.heartbeat` event; the heartbeat
// subscriber logs it. Smoke checks tail the log for a recent entry to
// assert the worker is alive end-to-end (schedule registered → BullMQ
// triggered → handler fired → event emitted → subscriber ran).
//
// One minute is the lowest cadence that still gives a near-real-time
// alive signal without burying Bull Board in completed-job rows.
export const HEARTBEAT_SCHEDULE = {
  name: 'heartbeat',
  every: 60_000
} as const

registerSchedule(HEARTBEAT_SCHEDULE.name, async () => {
  await emit({ type: 'worker.heartbeat', ts: new Date().toISOString() })
})
