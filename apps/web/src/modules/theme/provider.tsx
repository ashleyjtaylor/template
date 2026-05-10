import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { type ResolvedTheme, type Theme, ThemeContext } from './api'

const STORAGE_KEY = 'web:theme'
const VALID_THEMES: ReadonlySet<Theme> = new Set(['light', 'dark', 'system'])

const isTheme = (value: unknown): value is Theme =>
  typeof value === 'string' && VALID_THEMES.has(value as Theme)

const getSystemTheme = (): ResolvedTheme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

const readStoredTheme = (): Theme => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    return isTheme(raw) ? raw : 'system'
  } catch {
    // Storage unavailable (private mode, disabled cookies). Fall back to
    // system — the in-memory state is still functional for the session.
    return 'system'
  }
}

const applyResolvedTheme = (resolved: ResolvedTheme): void => {
  const root = document.documentElement

  if (resolved === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

interface ThemeProviderProps {
  children: ReactNode
  // Test seam — production callers omit and the provider reads from
  // localStorage. Tests pass an explicit value to bypass the storage hop.
  defaultTheme?: Theme
}

export function ThemeProvider({ children, defaultTheme }: ThemeProviderProps) {
  // SSR-safe initial value: 'system' on server, real value on client. Vite
  // SPAs are CSR-only today but the pattern stays correct if SSR ever lands.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme ?? 'system'

    return defaultTheme ?? readStoredTheme()
  })

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === 'undefined') return 'light'

    return getSystemTheme()
  })

  // Listen to OS-level theme changes. Always active — cheap, and means
  // switching from 'light' to 'system' immediately reflects the current OS
  // value without needing a re-fetch.
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light')

    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme

  // Apply class to <html> whenever the resolved theme changes.
  useEffect(() => {
    applyResolvedTheme(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)

    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage unavailable — the in-memory state is still updated.
    }
  }, [])

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}
