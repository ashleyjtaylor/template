import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
  // jsdom retains <html> attributes and storage between tests in the same
  // file; reset the dark class + localStorage so ThemeProvider tests don't
  // see leakage from a prior run.
  document.documentElement.classList.remove('dark')
  window.localStorage.clear()
})
