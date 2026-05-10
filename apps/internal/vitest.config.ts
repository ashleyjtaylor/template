import { defineConfig } from 'vitest/config'

// Node 26 turned the experimental WebStorage API on by default; Node's
// `globalThis.localStorage` then collides with jsdom's polyfill and
// `window.localStorage` ends up undefined. `--no-webstorage` tells Node
// to leave the slot to jsdom. The flag does not exist on Node 24 (where
// WebStorage is opt-in via `--experimental-webstorage`), so passing it
// would crash the worker — gate on the Node major.
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
const execArgv = nodeMajor >= 26 ? ['--no-webstorage'] : []

export default defineConfig({
  resolve: {
    tsconfigPaths: true
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    execArgv
  }
})
