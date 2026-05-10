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

export interface RouterContext {
  queryClient: QueryClient
}

const UNAUTHED_PATHS: ReadonlySet<string> = new Set([
  '/login',
  '/signup',
  '/team-signup',
  '/accept-invite'
])

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

// Single source of redirect truth. The session query also feeds the
// sidebar UserMenu, so it's called once per app load and cached. Per-page
// 401 effects are not needed.
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

  if (isLoading) return null
  if (!isAuthed && !isUnauthedRoute) return null
  if (isAuthed && isUnauthedRoute) return null

  return children
}
