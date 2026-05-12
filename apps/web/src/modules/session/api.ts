import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api'
import { sessionSchema } from './schemas'

const SESSION_KEY = ['session'] as const

export const useSession = () => {
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api('/api/auth/get-session', sessionSchema),
    staleTime: 60_000,
    refetchOnWindowFocus: true
  })

  return {
    session: query.data ?? null,
    user: query.data?.user ?? null,
    isAuthed: Boolean(query.data),
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error
  }
}

// Every auth mutation invalidates the session AND any per-user query
// (currently just the org list). Without invalidating orgs, the UserMenu
// + Home widget can show stale or empty data — most visibly after a
// team-signup, where `useMyOrgs` may serve an empty cache for ~60s
// before the next natural refetch.
const invalidateAfterAuth = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: SESSION_KEY }),
    qc.invalidateQueries({ queryKey: ['orgs'] })
  ])

export interface SignInInput {
  email: string
  password: string
}

export const useSignIn = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: SignInInput) =>
      api('/api/auth/sign-in/email', z.unknown(), { method: 'POST', body: input }),
    onSuccess: () => invalidateAfterAuth(queryClient)
  })
}

export interface SignUpInput {
  email: string
  password: string
  firstname: string
  lastname: string
}

export const useSignUp = () => {
  const queryClient = useQueryClient()

  // Routes through /api/orgs/sign-up rather than better-auth's bare
  // /api/auth/sign-up/email so every user lands with a personal org —
  // no orphan users, no "solo accounts" without billing surface. The
  // server picks the default org name when `organisationName` is omitted.
  return useMutation({
    mutationFn: (input: SignUpInput) =>
      api('/api/orgs/sign-up', z.unknown(), { method: 'POST', body: input }),
    onSuccess: () => invalidateAfterAuth(queryClient)
  })
}

export interface SignUpTeamInput extends SignUpInput {
  organisationName: string
}

export const useSignUpTeam = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: SignUpTeamInput) =>
      api('/api/orgs/sign-up', z.unknown(), { method: 'POST', body: input }),
    onSuccess: () => invalidateAfterAuth(queryClient)
  })
}

export const useSignOut = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => api('/api/auth/sign-out', z.unknown(), { method: 'POST', body: {} }),
    // Clear the entire React Query cache so the next user (whoever signs
    // in on this browser) doesn't see anything from the previous session.
    onSettled: () => queryClient.clear()
  })
}
