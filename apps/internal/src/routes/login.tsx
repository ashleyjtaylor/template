import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Loader2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/api'
import { useSignIn } from '@/modules/session/api'

export const Route = createFileRoute('/login')({
  component: LoginPage
})

const friendlyError = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Email or password is incorrect.'
    if (err.status === 403) return 'This account is not permitted here.'
    if (err.status >= 500) return 'Something went wrong on our end. Try again in a moment.'
  }

  return 'Could not sign you in. Try again.'
}

function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const signIn = useSignIn()

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    // The mutate-level onSuccess fires after useSignIn's invalidateSession
    // resolves, so the cached session is fresh by the time we navigate —
    // AuthGate then sees isAuthed: true and lets the home dashboard render.
    signIn.mutate({ email, password }, { onSuccess: () => navigate({ to: '/' }) })
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Engineering dot-grid backdrop. aria-hidden so screen readers ignore it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,_var(--foreground)_1px,_transparent_0)] [background-size:24px_24px]"
      />

      {/* Top + bottom edge fade so the grid melts into the page edges */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent"
      />

      <div className="relative flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="relative rounded-lg border bg-card shadow-sm">
            {/* Single-pixel top accent — quietly signals the card is "live" */}
            <div
              aria-hidden
              className="absolute -top-px right-6 left-6 h-px bg-gradient-to-r from-transparent via-foreground/30 to-transparent"
            />

            <div className="px-6 pt-7 pb-6">
              <div className="mb-6">
                <div className="mb-2 text-[10px] font-medium text-muted-foreground uppercase">
                  Internal Console
                </div>
                <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
                <p className="mt-1 text-sm text-muted-foreground">Restricted to staff accounts.</p>
              </div>

              {signIn.isError && (
                <div
                  role="alert"
                  className="mb-5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
                >
                  {friendlyError(signIn.error)}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="email"
                    className="block text-[10px] font-medium text-muted-foreground uppercase"
                  >
                    Email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={signIn.isPending}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="password"
                    className="block text-[10px] font-medium text-muted-foreground uppercase"
                  >
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={signIn.isPending}
                  />
                </div>

                <Button type="submit" className="group w-full" disabled={signIn.isPending}>
                  {signIn.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </Button>
              </form>
            </div>
          </div>

          <div className="mt-5 text-center text-[10px] text-muted-foreground/60 uppercase">
            Staff Access · Authorised use only
          </div>
        </div>
      </div>
    </div>
  )
}
