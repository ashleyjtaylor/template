import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface NavItemProps {
  to: string
  icon: LucideIcon
  children: ReactNode
}

// One sidebar nav link. TanStack Router's Link sets `data-status="active"`
// on the rendered anchor when the current URL matches `to`; styling hangs
// off that attribute so we don't need to thread isActive through props.
export function NavItem({ to, icon: Icon, children }: NavItemProps) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none',
        'data-[status=active]:bg-accent data-[status=active]:text-foreground data-[status=active]:font-medium'
      )}
    >
      <Icon className="size-4" />
      {children}
    </Link>
  )
}
