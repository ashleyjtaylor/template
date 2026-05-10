// Discriminated union of every audit action our code can emit. Past-tense by
// default; CRUD-style (`<resource>.created` / `.updated` / `.deleted`) where it
// reads more naturally — picked per event when introduced. See `audit` skill
// for the full convention.
//
// Auth and org governance events have callers wired today. Staff entries
// exist as type members with no callers yet — they will be wired by their
// respective feature PRs (no helpers / wrappers under three call sites).
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
  // Org governance — wired today
  | { action: 'organisation.created'; actorUserId: string; resourceId: string; name: string }
  | {
      action: 'organisation.name_changed'
      actorUserId: string
      resourceId: string
      before: string
      after: string
    }
  | {
      action: 'organisation.member.invited'
      actorUserId: string
      resourceId: string
      email: string
      role: string
      invitationId: string
    }
  | {
      action: 'organisation.invitation.revoked'
      actorUserId: string
      resourceId: string
      invitationId: string
    }
  | {
      action: 'organisation.invitation.accepted'
      actorUserId: string
      resourceId: string
      invitationId: string
      alreadyMember: boolean
    }
  | {
      action: 'organisation.member.role_changed'
      actorUserId: string
      resourceId: string
      targetUserId: string
      before: string
      after: string
    }
  | {
      action: 'organisation.ownership.transferred'
      actorUserId: string
      resourceId: string
      targetUserId: string
    }
  | {
      action: 'organisation.member.removed'
      actorUserId: string
      resourceId: string
      targetUserId: string
    }
  | { action: 'organisation.member.left'; actorUserId: string; resourceId: string }
  // Staff — type entries only, no callers yet
  | { action: 'staff.impersonation.started'; actorUserId: string; targetUserId: string }
  | { action: 'staff.impersonation.stopped'; actorUserId: string; targetUserId: string }

export interface AuditContext {
  ipAddress?: string | null
  userAgent?: string | null
  actorImpersonatorId?: string | null
}
