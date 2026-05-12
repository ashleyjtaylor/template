import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Loader2, Users } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { AuthCardLayout, AuthField } from '@/components/layout/AuthCardLayout'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { safeRedirect } from '@/lib/redirect'
import { useSignUp } from '@/modules/session/api'

const searchSchema = z.object({
  redirect: z.string().optional(),
  // When arriving from /accept-invite, the email is fixed by the
  // invitation. The form pre-fills it and disables the input — the API
  // would reject a mismatched address on accept anyway, so editing is
  // pure UX noise.
  email: z.email().optional()
})

export const Route = createFileRoute('/signup')({
  validateSearch: searchSchema,
  component: SignUpPage
})

const friendlyError = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.status === 422) return 'That email is already in use.'
    if (err.status === 400) return 'Please check the form for missing or invalid fields.'
    if (err.status >= 500) return 'Something went wrong on our end. Try again in a moment.'
  }

  return 'Could not create your account. Try again.'
}

function SignUpPage() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const signUp = useSignUp()
  const [firstname, setFirstname] = useState('')
  const [lastname, setLastname] = useState('')
  const [email, setEmail] = useState(search.email ?? '')
  const [password, setPassword] = useState('')
  const lockEmail = Boolean(search.email)

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    signUp.mutate(
      { firstname, lastname, email, password },
      { onSuccess: () => navigate({ to: safeRedirect(search.redirect) }) }
    )
  }

  return (
    <AuthCardLayout
      eyebrow="App"
      title="Create account"
      subtitle="Sign up with your email."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            search={{ redirect: search.redirect, email: search.email }}
            className="text-foreground underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      {signUp.isError && (
        <div
          role="alert"
          className="mb-5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
        >
          {friendlyError(signUp.error)}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <AuthField
            id="firstname"
            label="First name"
            type="text"
            autoComplete="given-name"
            autoFocus
            value={firstname}
            onChange={setFirstname}
            disabled={signUp.isPending}
          />
          <AuthField
            id="lastname"
            label="Last name"
            type="text"
            autoComplete="family-name"
            value={lastname}
            onChange={setLastname}
            disabled={signUp.isPending}
          />
        </div>
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          disabled={signUp.isPending || lockEmail}
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          disabled={signUp.isPending}
        />

        <Button type="submit" className="group w-full" disabled={signUp.isPending}>
          {signUp.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              Create account
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </Button>
      </form>

      <Link
        to="/team-signup"
        className="group mt-6 flex items-center gap-3 rounded-md border border-dashed border-foreground/20 bg-muted/40 px-3 py-2.5 transition-colors hover:border-foreground/40 hover:bg-muted/70"
      >
        <Users className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
        <span className="flex-1 text-xs text-muted-foreground">Creating a team workspace?</span>
        <span className="text-xs font-medium text-foreground">
          Team sign-up
          <ArrowRight className="ml-1 inline size-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </AuthCardLayout>
  )
}
