import { Link } from '@tanstack/react-router'
import { ExternalLink, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface NavItemProps {
  to: string
  icon: LucideIcon
  children: ReactNode
  // External links (e.g. server-rendered Bull Board at /api/admin/queues)
  // open in a new tab and bypass TanStack Router.
  external?: boolean
}

const className = cn(
  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors',
  'hover:bg-accent hover:text-accent-foreground',
  'focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none',
  'data-[status=active]:bg-accent data-[status=active]:text-foreground data-[status=active]:font-medium'
)

// One sidebar nav link. TanStack Router's Link sets `data-status="active"`
// on the rendered anchor when the current URL matches `to`; styling hangs
// off that attribute so we don't need to thread isActive through props.
export function NavItem({ to, icon: Icon, children, external }: NavItemProps) {
  if (external) {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" className={className}>
        <Icon className="size-4" />
        <span className="flex-1">{children}</span>
        <ExternalLink aria-hidden className="size-3 text-muted-foreground/60" />
      </a>
    )
  }

  return (
    <Link to={to} className={className}>
      <Icon className="size-4" />
      {children}
    </Link>
  )
}
