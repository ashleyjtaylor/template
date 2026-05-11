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
# --ignore-scripts skips lefthook + prisma generate (the latter needs schema
# files not yet copied in this layer). We invoke prisma generate explicitly
# in the build stage once schema files are on disk.
RUN pnpm install --frozen-lockfile --filter @template/api... --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/errors ./packages/errors
COPY packages/db ./packages/db
COPY packages/events ./packages/events
COPY apps/api ./apps/api
# Generate the Prisma Client. Workspace deps are symlinks (default pnpm
# behaviour), so the generated client lives at packages/db/node_modules/...
# and resolves through the symlink chain from apps/api at runtime.
RUN pnpm --filter @template/db exec prisma generate
# Build workspace packages then the app, in dependency order.
RUN pnpm --filter @template/errors build
RUN pnpm --filter @template/db build
RUN pnpm --filter @template/events build
RUN pnpm --filter @template/api build
# Strip devDependencies in place. --frozen-lockfile + --prod keeps the
# lockfile honest; the symlink chain to workspace packages survives.
# `CI=true` skips pnpm's interactive prompt before purging node_modules
# (the prod-only install replaces the dev+prod node_modules from the deps
# stage); without it pnpm aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY.
RUN CI=true pnpm install --frozen-lockfile --filter @template/api... --prod --ignore-scripts

FROM node:24.15.0-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG GIT_SHA=""
ENV NODE_ENV=production \
    PORT=3000 \
    GIT_SHA=$GIT_SHA
# Copy the built, prod-only workspace from the build stage. Symlinks survive
# the COPY (Docker preserves them). apps/api's runtime resolves @template/*
# via apps/api/node_modules/@template/* → ../../packages/*.
COPY --from=build --chown=node:node /repo /app
USER node
EXPOSE 3000
# WORKDIR is /app (the workspace root). apps/api's CMD uses a workspace-
# relative path; the migrator task overrides CMD to invoke prisma from
# packages/db (see infra/cdk/lib/data-stack.ts).
CMD ["node", "apps/api/dist/index.js"]
