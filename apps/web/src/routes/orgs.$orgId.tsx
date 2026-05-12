import { createFileRoute, Outlet } from '@tanstack/react-router'
import { OrgPaywallGate } from '@/modules/billing/OrgPaywallGate'

export const Route = createFileRoute('/orgs/$orgId')({
  component: OrgScopedLayout
})

// Layout for every org-scoped route. Mounts the paywall gate so all
// children (`/orgs/$orgId/settings/people`, `/orgs/$orgId/settings/billing`,
// etc.) share one access check + one redirect target. Child routes do
// not need to think about billing state.
function OrgScopedLayout() {
  const { orgId } = Route.useParams()

  return (
    <OrgPaywallGate orgId={orgId}>
      <Outlet />
    </OrgPaywallGate>
  )
}
