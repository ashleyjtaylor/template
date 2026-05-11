import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { env } from './env.js'

// Re-export everything @prisma/client exposes (entity types, Prisma namespace,
// error classes) so consumers depend only on @template/db.
export * from '@prisma/client'

// Stash the client on globalThis in non-production so hot-reload tools
// (tsx watch, vite-ssr, vitest workers, Next.js dev server, etc.) reuse the
// same instance across module re-imports. Without this, each reload creates
// a new PrismaClient and leaks DB connections until the pool is exhausted.
// Production always gets a fresh instance — there's no module re-import to
// dedupe against.
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient }

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']
  })
}

export const prisma = globalForPrisma.__prisma ?? createClient()

if (env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma
}
