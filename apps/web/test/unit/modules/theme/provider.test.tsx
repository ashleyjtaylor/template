import { act, render } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTheme } from '@/modules/theme/api'
import { ThemeProvider } from '@/modules/theme/provider'

// jsdom doesn't implement matchMedia. Build a controllable shim so each test
// can flip prefers-color-scheme, capture the listener that ThemeProvider
// attaches, and fire 'change' events on demand.
type MqlListener = (event: MediaQueryListEvent) => void

function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<MqlListener>()
  const mql: MediaQueryList = {
    matches: initialMatches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: ((event: string, cb: MqlListener) => {
      if (event === 'change') listeners.add(cb)
    }) as MediaQueryList['addEventListener'],
    removeEventListener: ((event: string, cb: MqlListener) => {
      if (event === 'change') listeners.delete(cb)
    }) as MediaQueryList['removeEventListener'],
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn().mockReturnValue(true)
  }

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mql)
  })

  return {
    fireSystemChange(matches: boolean) {
      mql.matches = matches
      const event = { matches, media: mql.media } as MediaQueryListEvent

      for (const listener of listeners) listener(event)
    }
  }
}

function ThemeReader({ onMount }: { onMount: (ctx: ReturnType<typeof useTheme>) => void }) {
  const ctx = useTheme()

  useEffect(() => {
    onMount(ctx)
  })

  return null
}

function renderWithTheme(children: ReactNode) {
  return render(<ThemeProvider>{children}</ThemeProvider>)
}

beforeEach(() => {
  document.documentElement.classList.remove('dark')
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ThemeProvider', () => {
  it("defaults to 'system' and follows prefers-color-scheme when nothing is stored", () => {
    installMatchMedia(true) // OS prefers dark

    renderWithTheme(<ThemeReader onMount={() => {}} />)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it("defaults to 'system' light when OS prefers light", () => {
    installMatchMedia(false)

    renderWithTheme(<ThemeReader onMount={() => {}} />)

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it("listens to live matchMedia changes when theme is 'system'", () => {
    const mql = installMatchMedia(false)

    renderWithTheme(<ThemeReader onMount={() => {}} />)
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => mql.fireSystemChange(true))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => mql.fireSystemChange(false))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('ignores OS changes when an explicit theme is selected', () => {
    const mql = installMatchMedia(false)
    let api: ReturnType<typeof useTheme> | undefined

    renderWithTheme(
      <ThemeReader
        onMount={(ctx) => {
          api = ctx
        }}
      />
    )

    act(() => api?.setTheme('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    // OS flips to light — explicit 'dark' should win.
    act(() => mql.fireSystemChange(false))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => api?.setTheme('light'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    // OS flips to dark — explicit 'light' should still win.
    act(() => mql.fireSystemChange(true))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('persists the chosen theme to localStorage', () => {
    installMatchMedia(false)
    let api: ReturnType<typeof useTheme> | undefined

    renderWithTheme(
      <ThemeReader
        onMount={(ctx) => {
          api = ctx
        }}
      />
    )

    act(() => api?.setTheme('dark'))
    expect(window.localStorage.getItem('web:theme')).toBe('dark')

    act(() => api?.setTheme('system'))
    expect(window.localStorage.getItem('web:theme')).toBe('system')
  })

  it('reads the persisted theme on mount', () => {
    installMatchMedia(false) // OS = light
    window.localStorage.setItem('web:theme', 'dark')

    renderWithTheme(<ThemeReader onMount={() => {}} />)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
