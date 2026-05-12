import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Loader2 } from 'lucide-react'
import { z } from 'zod'
import { AuthCardLayout } from '@/components/layout/AuthCardLayout'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { useAcceptInvite, usePreviewInvite } from '@/modules/invitations/api'
import { useSession } from '@/modules/session/api'

const searchSchema = z.object({
  token: z.string().optional()
})

export const Route = createFileRoute('/accept-invite')({
  validateSearch: searchSchema,
  component: AcceptInvitePage
})

const friendlyAcceptError = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'This invitation was sent to a different email address.'
    if (err.status === 404) return 'Invitation not found.'

    if (err.status === 409) {
      const reason =
        typeof err.details === 'object' && err.details !== null && 'reason' in err.details
          ? (err.details as { reason?: string }).reason
          : null

      if (reason === 'Expired') return 'This invitation has expired.'
      if (reason === 'AlreadyRevoked') return 'This invitation was revoked.'
      if (reason === 'AlreadyAccepted') return 'This invitation has already been accepted.'
    }

    if (err.status >= 500) return 'Something went wrong on our end. Try again in a moment.'
  }

  return 'Could not accept the invitation. Try again.'
}

function AcceptInvitePage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const { user, isAuthed, isLoading: isSessionLoading } = useSession()
  const preview = usePreviewInvite(token ?? '')
  const accept = useAcceptInvite()

  if (!token) {
    return (
      <AuthCardLayout
        eyebrow="App"
        title="No invite token"
        subtitle="Open this page from the invitation link."
      >
        <p className="text-xs text-muted-foreground">
          The link you used does not contain a token. Ask the person who invited you to resend it.
        </p>
      </AuthCardLayout>
    )
  }

  if (preview.isPending || isSessionLoading) {
    return (
      <AuthCardLayout eyebrow="App" title="Loading invite">
        <div className="flex justify-center py-4">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </AuthCardLayout>
    )
  }

  if (preview.isError || !preview.data) {
    return (
      <AuthCardLayout
        eyebrow="App"
        title="Invitation not found"
        subtitle="The invite link is invalid or has been revoked."
      >
        <Link
          to="/login"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Go to sign in
        </Link>
      </AuthCardLayout>
    )
  }

  const { organisation, role, email, invitedBy, status } = preview.data
  const inviterName = `${invitedBy.firstname} ${invitedBy.lastname}`.trim() || 'A teammate'
  const emailMatches = isAuthed && user?.email.toLowerCase() === email.toLowerCase()
  const terminalStatus = status !== 'pending'

  const handleAccept = () => {
    accept.mutate({ token }, { onSuccess: () => navigate({ to: '/' }) })
  }

  return (
    <AuthCardLayout
      eyebrow="App"
      title={`Join ${organisation.name}`}
      subtitle={`${inviterName} invited ${email} as ${role}.`}
    >
      {terminalStatus && (
        <div
          role="alert"
          className="mb-5 rounded-md border border-muted bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground"
        >
          This invitation is {status}. Ask for a new invite.
        </div>
      )}

      {accept.isError && (
        <div
          role="alert"
          className="mb-5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
        >
          {friendlyAcceptError(accept.error)}
        </div>
      )}

      {!isAuthed ? (
        <div className="space-y-3 text-xs text-muted-foreground">
          <p>
            Sign in or create an account using <strong className="text-foreground">{email}</strong>{' '}
            to accept this invitation.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() =>
                navigate({
                  to: '/login',
                  search: {
                    redirect: `/accept-invite?token=${encodeURIComponent(token)}`,
                    email
                  }
                })
              }
            >
              Sign in
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() =>
                navigate({
                  to: '/signup',
                  search: {
                    redirect: `/accept-invite?token=${encodeURIComponent(token)}`,
                    email
                  }
                })
              }
            >
              Create account
            </Button>
          </div>
        </div>
      ) : !emailMatches ? (
        <div className="space-y-3 text-xs text-muted-foreground">
          <p>
            You're signed in as <strong className="text-foreground">{user?.email}</strong>, but this
            invite was sent to <strong className="text-foreground">{email}</strong>. Sign out and
            sign back in with the matching account.
          </p>
        </div>
      ) : (
        <Button
          type="button"
          className="group w-full"
          onClick={handleAccept}
          disabled={accept.isPending || terminalStatus}
        >
          {accept.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              Accept invitation
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </Button>
      )}
    </AuthCardLayout>
  )
}
