import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api'
import { sessionSchema } from './schemas'

const SESSION_KEY = ['session'] as const

export const useSession = () => {
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api('/api/auth/get-session', sessionSchema),
    // get-session always returns 200 (null body when unauthed) so this query
    // never errors on the auth boundary — `data === null` is the unauthed
    // signal. Refetch on focus so a sign-out in another tab propagates.
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

const invalidateSession = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: SESSION_KEY })

export interface SignInInput {
  email: string
  password: string
}

export const useSignIn = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: SignInInput) =>
      api('/api/auth/sign-in/email', z.unknown(), { method: 'POST', body: input }),
    // Returning the invalidate promise pauses the mutation lifecycle until
    // the session query refetches — so any navigate() in the caller's
    // mutate-level onSuccess sees a fresh `useSession()` (otherwise the
    // AuthGate bounces back to /login because the cached session is still
    // null from the pre-login render).
    onSuccess: () => invalidateSession(queryClient)
  })
}

export const useSignOut = () => {
  const queryClient = useQueryClient()

  return useMutation({
    // better-auth's sign-out endpoint requires a (possibly empty) JSON body
    // and an Origin header — the api wrapper already sets Content-Type and
    // browsers attach Origin automatically.
    mutationFn: () => api('/api/auth/sign-out', z.unknown(), { method: 'POST', body: {} }),
    onSettled: () => queryClient.setQueryData(SESSION_KEY, null)
  })
}
