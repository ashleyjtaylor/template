import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeContextValue {
  // What the user picked. Persisted to localStorage.
  theme: Theme
  // The actual theme applied to <html>. When theme === 'system' this follows
  // prefers-color-scheme; otherwise mirrors `theme`.
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext)

  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')

  return ctx
}
