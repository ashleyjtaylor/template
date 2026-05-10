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
    onSuccess: () => invalidateSession(queryClient)
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

  return useMutation({
    mutationFn: (input: SignUpInput) =>
      api('/api/auth/sign-up/email', z.unknown(), {
        method: 'POST',
        body: { ...input, name: `${input.firstname} ${input.lastname}` }
      }),
    onSuccess: () => invalidateSession(queryClient)
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
    onSuccess: () => invalidateSession(queryClient)
  })
}

export const useSignOut = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => api('/api/auth/sign-out', z.unknown(), { method: 'POST', body: {} }),
    onSettled: () => queryClient.setQueryData(SESSION_KEY, null)
  })
}
