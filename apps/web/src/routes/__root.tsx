import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  Outlet,
  useNavigate,
  useRouterState
} from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Toaster } from '@/components/ui/toaster'
import { safeRedirect } from '@/lib/redirect'
import { useSession } from '@/modules/session/api'

export interface RouterContext {
  queryClient: QueryClient
}

// Routes only useful while signed out. An authed user landing here is
// bounced to `/`. Note: `/accept-invite` is deliberately NOT in this set
// because it is dual-mode — the page renders different UI for authed vs
// unauthed callers and must not be redirected away from in either state.
const UNAUTHED_ONLY_PATHS: ReadonlySet<string> = new Set(['/login', '/signup', '/team-signup'])

// Routes that don't require authentication but also aren't redirected away
// from when authed. Used for dual-mode pages like the invitation accept
// flow, which a signed-in user can land on by clicking an email link.
const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/accept-invite'])

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootRoute
})

function RootRoute() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const search = useRouterState({ select: (s) => s.location.search })
  const isUnauthedOnly = UNAUTHED_ONLY_PATHS.has(pathname)
  const isPublic = PUBLIC_PATHS.has(pathname)
  const hidesShell = isUnauthedOnly || isPublic

  return (
    <>
      <AuthGate isUnauthedOnly={isUnauthedOnly} isPublic={isPublic} search={search}>
        {hidesShell ? (
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
      <Toaster />
    </>
  )
}

interface AuthGateProps {
  isUnauthedOnly: boolean
  isPublic: boolean
  search: Record<string, unknown>
  children: ReactNode
}

// Single source of redirect truth. The session query also feeds the
// sidebar UserMenu, so it's called once per app load and cached. Per-page
// 401 effects are not needed.
function AuthGate({ isUnauthedOnly, isPublic, search, children }: AuthGateProps) {
  const navigate = useNavigate()
  const { isAuthed, isLoading } = useSession()

  useEffect(() => {
    if (isLoading) return

    // Unauthed visitor on a protected route → /login, preserving the
    // intended destination so the post-login navigate brings them back.
    if (!isAuthed && !isUnauthedOnly && !isPublic) {
      navigate({ to: '/login' })
      return
    }

    // Authed visitor on a signed-out-only route → honour an explicit
    // `?redirect=` if one was passed (e.g. follow-up after /login), else /.
    if (isAuthed && isUnauthedOnly) {
      const target = typeof search['redirect'] === 'string' ? search['redirect'] : undefined

      navigate({ to: safeRedirect(target) })
    }
  }, [isAuthed, isLoading, isUnauthedOnly, isPublic, search, navigate])

  if (isLoading) return null
  if (!isAuthed && !isUnauthedOnly && !isPublic) return null
  if (isAuthed && isUnauthedOnly) return null

  return children
}
