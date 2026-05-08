import { PrismaClient } from '@prisma/client'
import { env } from '../env.js'

// Stash the client on globalThis in non-production so hot-reload tools
// (tsx watch, vite-ssr, vitest workers, Next.js dev server, etc.) reuse the
// same instance across module re-imports. Without this, each reload creates
// a new PrismaClient and leaks DB connections until the pool is exhausted.
// Production always gets a fresh instance — there's no module re-import to
// dedupe against.
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient }

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']
  })

if (env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma
}
