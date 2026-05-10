import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Loader2, User } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { AuthCardLayout, AuthField } from '@/components/layout/AuthCardLayout'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { useSignUpTeam } from '@/modules/session/api'

export const Route = createFileRoute('/team-signup')({
  component: TeamSignUpPage
})

const friendlyError = (err: unknown): string => {
  if (err instanceof ApiError) {
    if (err.status === 422) return 'That email is already in use.'
    if (err.status === 400) return 'Please check the form for missing or invalid fields.'
    if (err.status >= 500) return 'Something went wrong on our end. Try again in a moment.'
  }

  return 'Could not create your workspace. Try again.'
}

function TeamSignUpPage() {
  const navigate = useNavigate()
  const signUpTeam = useSignUpTeam()
  const [organisationName, setOrganisationName] = useState('')
  const [firstname, setFirstname] = useState('')
  const [lastname, setLastname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    signUpTeam.mutate(
      { organisationName, firstname, lastname, email, password },
      { onSuccess: () => navigate({ to: '/' }) }
    )
  }

  return (
    <AuthCardLayout
      eyebrow="App"
      title="Create workspace"
      subtitle="Sign up and create your team's organisation."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-foreground underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {signUpTeam.isError && (
        <div
          role="alert"
          className="mb-5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
        >
          {friendlyError(signUpTeam.error)}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          id="organisationName"
          label="Workspace name"
          type="text"
          autoFocus
          value={organisationName}
          onChange={setOrganisationName}
          disabled={signUpTeam.isPending}
        />
        <div className="grid grid-cols-2 gap-3">
          <AuthField
            id="firstname"
            label="First name"
            type="text"
            autoComplete="given-name"
            value={firstname}
            onChange={setFirstname}
            disabled={signUpTeam.isPending}
          />
          <AuthField
            id="lastname"
            label="Last name"
            type="text"
            autoComplete="family-name"
            value={lastname}
            onChange={setLastname}
            disabled={signUpTeam.isPending}
          />
        </div>
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          disabled={signUpTeam.isPending}
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          disabled={signUpTeam.isPending}
        />

        <Button type="submit" className="group w-full" disabled={signUpTeam.isPending}>
          {signUpTeam.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              Create workspace
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </Button>
      </form>

      <Link
        to="/signup"
        className="group mt-6 flex items-center gap-3 rounded-md border border-dashed border-foreground/20 bg-muted/40 px-3 py-2.5 transition-colors hover:border-foreground/40 hover:bg-muted/70"
      >
        <User className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
        <span className="flex-1 text-xs text-muted-foreground">Just for yourself?</span>
        <span className="text-xs font-medium text-foreground">
          Personal sign-up
          <ArrowRight className="ml-1 inline size-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </AuthCardLayout>
  )
}
