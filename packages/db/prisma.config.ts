import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Prisma 7 moved the connection URL out of schema.prisma into this config
// (consumed by the CLI: migrate, db push, generate). The runtime client in
// src/lib/db.ts uses the adapter pattern (separate concern).
//
// URL composition is duplicated from src/env.ts on purpose: this file ships
// to the container's /prod directory (after `pnpm deploy --prod` strips
// devDeps + src) where importing from src/env.ts isn't possible. Both must
// produce the same URL — keep them in sync if you change either.
const envVar = (key: string, fallback: string) => process.env[key] ?? fallback

const user = envVar('DB_USER', 'postgres')
const password = encodeURIComponent(envVar('DB_PASSWORD', 'postgres'))
const host = envVar('DB_HOST', 'localhost')
const port = envVar('DB_PORT', '5432')
const database = envVar('DB_NAME', 'template_dev')

// RDS Postgres has `rds.force_ssl=1`; the connection is rejected without
// TLS. Local Postgres (Compose, CI service container) doesn't speak SSL —
// gate on the host name so we only opt in for RDS endpoints. Anchor the
// suffix match to a subdomain boundary (`.rds.amazonaws.com`) so a host
// like `evilrds.amazonaws.com` doesn't accidentally pass.
//
// `uselibpqcompat=true` matters for the runtime client in src/env.ts (where
// pg-connection-string interprets `sslmode=require` as `verify-full` and
// trips on RDS's Amazon CA). The Prisma CLI binary engine uses libpq
// semantics natively and ignores the flag, but we keep the two URLs
// identical to honour the cross-file invariant. Switch to
// `sslmode=verify-full` once the RDS CA bundle ships in the image.
const normalizedHost = host.trim().toLowerCase()
const isRds =
  normalizedHost === 'rds.amazonaws.com' || normalizedHost.endsWith('.rds.amazonaws.com')
const sslSuffix = isRds ? '?sslmode=require&uselibpqcompat=true' : ''

const url = `postgresql://${user}:${password}@${host}:${port}/${database}${sslSuffix}`

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations')
  },
  datasource: { url }
})
