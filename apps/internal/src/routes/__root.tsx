import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  Outlet,
  useNavigate,
  useRouterState
} from '@tanstack/react-router'
import { Loader2, LogOut } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { useSession, useSignOut } from '@/modules/session/api'

// `createRootRouteWithContext` declares the context shape that flows from
// the router's top-level `context: { queryClient }` (set in main.tsx).
// Loaders and beforeLoad hooks can then read it via `({ context }) => ...`.
export interface RouterContext {
  queryClient: QueryClient
}

// Routes that render without the sidebar / auth gate. Add new unauthed
// surfaces here as they ship (forgot-password, etc.).
const UNAUTHED_PATHS: ReadonlySet<string> = new Set(['/login'])

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootRoute
})

function RootRoute() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isUnauthedRoute = UNAUTHED_PATHS.has(pathname)

  return (
    <AuthGate isUnauthedRoute={isUnauthedRoute}>
      {isUnauthedRoute ? (
        <Outlet />
      ) : (
        <div className="flex h-screen">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      )}
    </AuthGate>
  )
}

interface AuthGateProps {
  isUnauthedRoute: boolean
  children: ReactNode
}

// Single source of redirect truth. The session query is also useSession's
// data source for the sidebar UserMenu, so it gets called once per app
// load and cached. Per-page 401 useEffects are no longer needed.
//
// The internal console is staff-only. A signed-in user with no
// `staffRole` is held at a full-page gate with a Sign-out CTA — they
// never see the app shell. The per-route `requireStaff` middleware on
// the API is the authoritative check; this is just the UX layer that
// makes the rejection obvious instead of letting a non-staff user
// wander into the sidebar and hit 403s.
function AuthGate({ isUnauthedRoute, children }: AuthGateProps) {
  const navigate = useNavigate()
  const { isAuthed, user, isLoading } = useSession()
  const hasStaffRole = Boolean(user?.staffRole)

  useEffect(() => {
    if (isLoading) return

    if (!isAuthed && !isUnauthedRoute) {
      navigate({ to: '/login' })
      return
    }

    if (isAuthed && isUnauthedRoute) {
      navigate({ to: '/' })
    }
  }, [isAuthed, isLoading, isUnauthedRoute, navigate])

  // Don't render anything until the session query resolves — avoids a flash
  // of /login or the protected page before the redirect lands.
  if (isLoading) return null

  // Effect-driven redirect is mid-flight; render nothing for one frame.
  if (!isAuthed && !isUnauthedRoute) return null
  if (isAuthed && isUnauthedRoute) return null

  // Authed but not a staff account: hold them at a full-page gate with
  // a Sign-out CTA. The login page (isUnauthedRoute) skips this check —
  // unauthenticated visitors haven't signed in yet, so no role to gate on.
  if (isAuthed && !isUnauthedRoute && !hasStaffRole) {
    return <StaffOnlyGate />
  }

  return children
}

function StaffOnlyGate() {
  const signOut = useSignOut()
  const navigate = useNavigate()

  const handleSignOut = () => {
    signOut.mutate(undefined, {
      onSettled: () => navigate({ to: '/login' })
    })
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,_var(--foreground)_1px,_transparent_0)] [background-size:24px_24px]"
      />
      <div className="relative w-full max-w-sm rounded-lg border bg-card px-6 py-7 text-center shadow-sm">
        <div className="text-[10px] font-medium text-destructive uppercase">
          Staff access required
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Restricted</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This console is only available to staff accounts. Sign out and use a staff account, or ask
          an existing staff member to grant your account access.
        </p>
        <Button
          variant="outline"
          className="mt-6 w-full"
          onClick={handleSignOut}
          disabled={signOut.isPending}
        >
          {signOut.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <LogOut className="size-4" />
              Sign out
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
