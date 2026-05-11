# syntax=docker/dockerfile:1.7

# Node and pnpm versions must match the root package.json `engines` and `packageManager` fields,
# and the `node-version` / pnpm `version` inputs in .github/workflows/ci.yml.
# bookworm-slim (Debian/glibc) chosen over alpine for broader native-module compatibility
# (most npm prebuilds target glibc) and to avoid musl's DNS/threading edge cases.
# openssl is required by Prisma's query engine to detect the right libssl variant —
# without it Prisma logs a warning and falls back to openssl-1.1.x.
FROM node:24.15.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.0.8
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY infra/cdk/package.json infra/cdk/
COPY packages/errors/package.json packages/errors/
COPY packages/db/package.json packages/db/
COPY packages/events/package.json packages/events/
# --ignore-scripts skips the root `prepare` (`lefthook install`, which needs a .git dir
# that doesn't exist in the build context), @prisma/client's postinstall (we run
# `prisma generate` explicitly below), and esbuild's postinstall.
RUN pnpm install --frozen-lockfile --filter @template/api... --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/errors ./packages/errors
COPY packages/db ./packages/db
COPY packages/events ./packages/events
COPY apps/api ./apps/api
# Re-install now that source files are on disk. The deps stage installed with
# only package.json files copied — workspace injections (packages/*/
# node_modules/@template/*) were therefore created with no `src/`, so any
# downstream tsc that resolves `@template/db` via the `types` exports
# condition (→ ./src/index.ts) would fail. Re-running pnpm install with src
# in place re-injects with the full source tree.
RUN pnpm install --frozen-lockfile --filter @template/api... --ignore-scripts
# Generate Prisma Client. The deps stage installs with --ignore-scripts so
# @prisma/client's postinstall (`prisma generate`) is skipped — invoke it
# explicitly here. tsc compiling packages/db imports `PrismaClient` from
# `@prisma/client`, which only exists after this step.
RUN pnpm --filter @template/db exec prisma generate
# Build workspace packages in dependency order.
RUN pnpm --filter @template/errors build
RUN pnpm --filter @template/db build
RUN pnpm --filter @template/events build
# Re-install once more so the built dist/ propagates into injections, then
# `pnpm deploy --prod` below copies a complete dist/ for each workspace dep.
RUN pnpm install --frozen-lockfile --filter @template/api... --ignore-scripts
RUN pnpm --filter @template/api build
# --ignore-scripts skips the root `prepare` (`lefthook install`); we don't want
# git hooks installed inside the container. Workspace-package injection is opted
# into via `injectWorkspacePackages: true` in pnpm-workspace.yaml.
RUN pnpm --filter @template/api deploy --prod --ignore-scripts /prod
# Re-generate the Prisma Client into the deployed node_modules. `pnpm deploy`
# creates a fresh node_modules in /prod with no .prisma artifacts, so without
# this step the runtime would fail on import. `prisma` is in @template/db's
# runtime deps so the CLI is available in /prod/node_modules/.bin.
# prisma.config.ts + schema ship alongside so the migrator task can run
# `prisma migrate deploy` from /prod.
RUN cp -r packages/db/prisma /prod/prisma && cp packages/db/prisma.config.ts /prod/prisma.config.ts
RUN cd /prod && node_modules/.bin/prisma generate

FROM node:24.15.0-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG GIT_SHA=""
ENV NODE_ENV=production \
    PORT=3000 \
    GIT_SHA=$GIT_SHA
COPY --from=build --chown=node:node /prod ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
