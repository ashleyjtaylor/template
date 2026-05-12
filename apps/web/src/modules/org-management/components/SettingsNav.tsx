import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

interface SettingsNavProps {
  orgId: string
}

// Shared sub-nav for every /orgs/:orgId/settings/* page. Lets users move
// between People and Billing without going via Home.
export function SettingsNav({ orgId }: SettingsNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const items = [
    { label: 'People', to: '/orgs/$orgId/settings/people' as const },
    { label: 'Billing', to: '/orgs/$orgId/settings/billing' as const }
  ]

  return (
    <nav aria-label="Settings" className="mb-6 flex gap-1 border-b border-border/60 text-sm">
      {items.map((item) => {
        const active = pathname.endsWith(item.to.replace('$orgId', orgId))

        return (
          <Link
            key={item.to}
            to={item.to}
            params={{ orgId }}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 transition-colors',
              active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
