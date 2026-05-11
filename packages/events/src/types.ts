// The full set of domain events the app emits. Forks extend this union with
// their own events (e.g. `'report.generated'`); subscribers register handlers
// in apps/worker/src/subscribers/.
//
// Each event carries its `type` plus the minimal payload subscribers need.
// No PII beyond what's strictly required (handlers can re-fetch from DB by
// id). Payloads are JSON-serialised onto BullMQ jobs, so keep them shallow.
export type DomainEvent = WorkerHeartbeatEvent | InvitationCreatedEvent

export interface WorkerHeartbeatEvent {
  type: 'worker.heartbeat'
  ts: string
}

export interface InvitationCreatedEvent {
  type: 'invitation.created'
  invitationId: string
  organisationId: string
  email: string
  role: string
}
