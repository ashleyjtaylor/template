import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    // Node 24+ ships an experimental built-in `localStorage` global
    // (`globalThis.localStorage`) as a non-configurable property. jsdom
    // tries to install its own `Storage` into the same slot and silently
    // loses the race — `window.localStorage` ends up undefined. The flag
    // tells Node to leave the slot alone so jsdom owns it.
    execArgv: ['--no-webstorage']
  }
})
