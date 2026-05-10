// Discriminated union of every audit action our code can emit. Past-tense by
// default; CRUD-style (`<resource>.created` / `.updated` / `.deleted`) where it
// reads more naturally — picked per event when introduced. See `audit` skill
// for the full convention.
//
// Auth events have callers wired today via better-auth's databaseHooks.after.
// Org and staff entries exist as type members with no callers yet — they will
// be wired by their respective feature PRs (no helpers / wrappers under three
// call sites).
export type AuditEvent =
  // Auth — wired today
  | {
      action: 'user.signed_up'
      actorUserId: string
      email: string
      firstname: string
      lastname: string
    }
  | { action: 'user.logged_in'; actorUserId: string }
  | { action: 'user.logged_out'; actorUserId: string }
  // Org governance — type entries only, no callers yet
  | { action: 'organisation.created'; actorUserId: string; resourceId: string; name: string }
  | {
      action: 'organisation.member.invited'
      actorUserId: string
      resourceId: string
      email: string
      role: string
    }
  | {
      action: 'organisation.role.changed'
      actorUserId: string
      resourceId: string
      targetUserId: string
      before: string
      after: string
    }
  // Staff — type entries only, no callers yet
  | { action: 'staff.impersonation.started'; actorUserId: string; targetUserId: string }
  | { action: 'staff.impersonation.stopped'; actorUserId: string; targetUserId: string }

export interface AuditContext {
  ipAddress?: string | null
  userAgent?: string | null
  actorImpersonatorId?: string | null
}
