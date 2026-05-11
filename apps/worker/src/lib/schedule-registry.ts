// Schedule handlers are looked up by name when a job on the `schedules` queue
// fires. Each schedule file calls registerSchedule(name, handler) at import
// time. apps/worker/src/index.ts imports the schedule files so registration
// happens before the Worker starts processing jobs.
type ScheduleHandler = () => Promise<void>

const handlers = new Map<string, ScheduleHandler>()

export function registerSchedule(name: string, handler: ScheduleHandler): void {
  handlers.set(name, handler)
}

export function getScheduleHandler(name: string): ScheduleHandler | undefined {
  return handlers.get(name)
}
