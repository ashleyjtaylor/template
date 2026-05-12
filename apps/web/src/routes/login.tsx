import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Loader2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { AuthCardLayout, AuthField } from '@/components/layout/AuthCardLayout'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { safeRedirect } from '@/lib/redirect'
import { useSignIn } from '@/modules/session/api'

const searchSchema = z.object({
  redirect: z.string().optional()
})

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  component: LoginPage
})

const friendlyError = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Email or password is incorrect.'
    if (err.status >= 500) return 'Something went wrong on our end. Try again in a moment.'
  }

  return 'Could not sign you in. Try again.'
}

function LoginPage() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const signIn = useSignIn()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    signIn.mutate(
      { email, password },
      { onSuccess: () => navigate({ to: safeRedirect(search.redirect) }) }
    )
  }

  return (
    <AuthCardLayout
      eyebrow="App"
      title="Sign in"
      subtitle="Enter your account credentials."
      footer={
        <>
          New here?{' '}
          <Link
            to="/signup"
            search={{ redirect: search.redirect }}
            className="underline-offset-2 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      {signIn.isError && (
        <div
          role="alert"
          className="mb-5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
        >
          {friendlyError(signIn.error)}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={setEmail}
          disabled={signIn.isPending}
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          disabled={signIn.isPending}
        />

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
    </AuthCardLayout>
  )
}
