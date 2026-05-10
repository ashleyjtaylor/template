import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  Outlet,
  useNavigate,
  useRouterState
} from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { useSession } from '@/modules/session/api'

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
function AuthGate({ isUnauthedRoute, children }: AuthGateProps) {
  const navigate = useNavigate()
  const { isAuthed, isLoading } = useSession()

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

  return children
}
