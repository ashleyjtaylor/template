import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError } from '@/lib/api'
import { useMyOrgs } from '@/modules/org-management/api'
import { InvitationsSection } from '@/modules/org-management/components/InvitationsSection'
import { MembersSection } from '@/modules/org-management/components/MembersSection'
import { useSession } from '@/modules/session/api'

export const Route = createFileRoute('/orgs/$orgId/settings/people')({
  component: PeoplePage
})

function PeoplePage() {
  const { orgId } = Route.useParams()
  const navigate = useNavigate()
  const { user } = useSession()
  const myOrgs = useMyOrgs()

  if (myOrgs.isLoading || !user) {
    return (
      <PageShell title="People">
        <div className="flex items-center gap-2 px-4 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      </PageShell>
    )
  }

  const myMembership = myOrgs.data?.find((o) => o.organisation.entityId === orgId)

  if (myOrgs.isError) {
    const is401 = myOrgs.error instanceof ApiError && myOrgs.error.status === 401

    if (is401) return null

    return (
      <PageShell title="People">
        <FullPageBlock title="Something went wrong" detail="Could not load this organisation." />
      </PageShell>
    )
  }

  if (!myMembership) {
    // Either the org doesn't exist or the caller isn't a member. We
    // collapse both into a single message rather than leaking existence.
    return (
      <PageShell title="People">
        <FullPageBlock
          title="Organisation not found"
          detail="You don't have access to this organisation, or it does not exist."
        />
      </PageShell>
    )
  }

  const callerRole = myMembership.membership.role

  return (
    <PageShell title="People" subtitle={myMembership.organisation.name}>
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersSection
            orgId={orgId}
            callerUserEntityId={user.entityId}
            callerRole={callerRole}
            onLeft={() => navigate({ to: '/' })}
          />
        </TabsContent>
        <TabsContent value="invitations">
          <InvitationsSection orgId={orgId} callerRole={callerRole} />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}

interface PageShellProps {
  title: string
  subtitle?: string
  children: React.ReactNode
}

function PageShell({ title, subtitle, children }: PageShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,_var(--foreground)_1px,_transparent_0)] [background-size:24px_24px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-background to-transparent"
      />

      <div className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <div className="text-[10px] font-medium uppercase text-muted-foreground/70">
            <Link to="/" className="hover:text-foreground">
              Home
            </Link>{' '}
            · Settings
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </header>

        {children}
      </div>
    </div>
  )
}

function FullPageBlock({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card/60 px-4 py-20 text-center shadow-xs">
      <div className="text-[10px] uppercase text-destructive">{title}</div>
      <p className="text-sm text-foreground">{detail}</p>
    </div>
  )
}
