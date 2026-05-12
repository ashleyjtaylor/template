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
  // Raw invitation token. Carried in the event so the email subscriber can
  // build the accept-invite URL without rotating the token (which would
  // invalidate the link returned by POST /api/orgs/:id/invitations).
  // Transits the outbox (Postgres, encrypted at rest) and BullMQ
  // (ElastiCache, TLS + AUTH + at-rest encryption). 7-day TTL, single-use,
  // revoked-on-accept — the insider-risk window is bounded and consistent
  // with what staff with backend access can already do (read invitation
  // rows, generate accept calls). Forks needing stricter compliance can
  // switch to rotating the token in the worker handler instead.
  rawToken: string
}
