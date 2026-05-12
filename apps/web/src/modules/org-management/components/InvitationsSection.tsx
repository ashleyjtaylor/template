import { Loader2, Send } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import { useCreateInvitation, useInvitations, useRevokeInvitation } from '../api'
import type { InvitationRow, InviteRole, Role } from '../schemas'
import { formatDate, fullName, roleLabel } from '../utils'
import { ConfirmDialog } from './ConfirmDialog'

interface InvitationsSectionProps {
  orgId: string
  callerRole: Role
}

export function InvitationsSection({ orgId, callerRole }: InvitationsSectionProps) {
  const invitations = useInvitations(orgId)
  const createInvitation = useCreateInvitation(orgId)
  const revokeInvitation = useRevokeInvitation(orgId)
  const [revoking, setRevoking] = useState<InvitationRow | null>(null)

  // Only admins + owners may invite. The API enforces this with 403;
  // the form is hidden for members so they don't see a control they
  // can't use.
  const canInvite = callerRole === 'owner' || callerRole === 'admin'

  const handleConfirmRevoke = async () => {
    if (!revoking) return

    try {
      await revokeInvitation.mutateAsync(revoking.invitation.entityId)
      toast.success(`Invitation to ${revoking.invitation.email} revoked`)
      setRevoking(null)
    } catch (err) {
      toast.error(humaniseRevokeError(err))
      setRevoking(null)
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card/60 shadow-xs">
      {canInvite && <InviteForm createInvitation={createInvitation} />}

      {invitations.isLoading ? (
        <div>
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
              key={i}
              className="flex items-center justify-between border-b px-4 py-3 last:border-b-0"
            >
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : invitations.isError ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          Could not load invitations.
        </div>
      ) : (invitations.data ?? []).length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          No pending invitations.
        </div>
      ) : (
        <ul>
          {invitations.data?.map((row) => (
            <li
              key={row.invitation.entityId}
              className="flex items-center justify-between gap-4 border-t px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{row.invitation.email}</div>
                <div className="truncate text-xs text-muted-foreground">
                  Invited by {fullName(row.invitedBy)} · expires{' '}
                  {formatDate(row.invitation.expiresAt)}
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                {roleLabel[row.invitation.role]}
              </span>
              {canInvite && (
                <Button variant="ghost" size="sm" onClick={() => setRevoking(row)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke invitation"
        description={
          revoking ? (
            <>
              Revoke the invitation sent to <strong>{revoking.invitation.email}</strong>? They will
              no longer be able to accept the existing link.
            </>
          ) : null
        }
        confirmLabel="Revoke"
        destructive
        busy={revokeInvitation.isPending}
        onConfirm={handleConfirmRevoke}
      />
    </section>
  )
}

interface InviteFormProps {
  createInvitation: ReturnType<typeof useCreateInvitation>
}

function InviteForm({ createInvitation }: InviteFormProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>('member')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      await createInvitation.mutateAsync({ email: email.trim(), role })
      toast.success(`Invitation sent to ${email.trim()}`)
      setEmail('')
      setRole('member')
    } catch (err) {
      setError(humaniseCreateError(err))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row">
      <Input
        type="email"
        required
        placeholder="teammate@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={createInvitation.isPending}
        className="flex-1"
        aria-label="Invitee email"
        aria-invalid={error !== null}
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as InviteRole)}
        disabled={createInvitation.isPending}
        aria-label="Role"
        className="h-9 rounded-md border bg-background px-2 text-sm shadow-xs disabled:opacity-50"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <Button type="submit" disabled={createInvitation.isPending || email.trim().length === 0}>
        {createInvitation.isPending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Send className="size-3" />
        )}
        Send
      </Button>
      {error && (
        <div className="text-xs text-destructive sm:order-last sm:basis-full" role="alert">
          {error}
        </div>
      )}
    </form>
  )
}

const humaniseCreateError = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.status === 400) return 'Enter a valid email.'
    if (err.status === 409) {
      if (err.code === 'Conflict') return 'An invitation for this email is already pending.'

      return err.message
    }
    if (err.status === 403) return 'Only admins and owners can invite.'
  }

  return 'Could not send invitation. Try again.'
}

const humaniseRevokeError = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'You do not have permission to revoke this invitation.'
    if (err.status === 404) return 'This invitation no longer exists.'
  }

  return 'Could not revoke invitation. Try again.'
}
