import { Home, Layers, ScrollText } from 'lucide-react'
import { ThemeToggle } from '@/modules/theme/ThemeToggle'
import { EnvBadge } from './EnvBadge'
import { NavItem } from './NavItem'
import { UserMenu } from './UserMenu'

export function Sidebar() {
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r bg-card/40">
      <div className="flex items-center gap-2 px-4 py-4">
        <div
          aria-hidden
          className="size-6 rounded-md bg-linear-to-br from-foreground to-foreground/50"
        />
        <span className="text-sm font-semibold tracking-tight">Internal</span>
      </div>

      <nav className="mt-2 flex flex-col gap-0.5 px-2">
        <NavItem to="/" icon={Home}>
          Home
        </NavItem>
        <NavItem to="/audit" icon={ScrollText}>
          Audit log
        </NavItem>
        <NavItem to="/api/admin/queues" icon={Layers} external>
          Queues
        </NavItem>
      </nav>

      <div className="mt-auto flex flex-col gap-2 px-3 pb-3">
        <EnvBadge />
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <UserMenu />
          </div>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  )
}
