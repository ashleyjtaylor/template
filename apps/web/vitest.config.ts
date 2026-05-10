import { defineConfig } from 'vitest/config'

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
    passWithNoTests: true,
    execArgv
  }
})
