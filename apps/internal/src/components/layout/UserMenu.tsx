import { useNavigate } from '@tanstack/react-router'
import { ChevronsUpDown, LogOut } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useSession, useSignOut } from '@/modules/session/api'

export function UserMenu() {
  const { user } = useSession()
  const signOut = useSignOut()
  const navigate = useNavigate()

  if (!user) return null

  const localPart = user.email.split('@')[0] ?? user.email
  const initials =
    localPart
      .split(/[._-]/)
      .map((s) => s.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('') || '?'

  const handleSignOut = () => {
    signOut.mutate(undefined, {
      onSettled: () => navigate({ to: '/login' })
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
          {initials}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs">{user.email}</span>
          {user.staffRole && (
            <span className="text-[10px] uppercase text-muted-foreground">{user.staffRole}</span>
          )}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
        <DropdownMenuItem disabled className="text-xs">
          <span className="truncate">{user.email}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOut className="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
