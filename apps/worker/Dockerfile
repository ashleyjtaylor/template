# syntax=docker/dockerfile:1.7

# Node and pnpm versions must match the root package.json `engines` and `packageManager`
# fields and the corresponding inputs in .github/workflows/ci.yml. See apps/api/Dockerfile
# for the base-image rationale (glibc over musl, openssl for Prisma).
FROM node:24.15.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.0.8
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/
COPY infra/cdk/package.json infra/cdk/
COPY packages/errors/package.json packages/errors/
COPY packages/db/package.json packages/db/
COPY packages/events/package.json packages/events/
# --ignore-scripts skips lefthook + prisma generate (the latter needs schema
# files not yet copied in this layer).
RUN pnpm install --frozen-lockfile --filter @template/worker... --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/errors ./packages/errors
COPY packages/db ./packages/db
COPY packages/events ./packages/events
COPY apps/worker ./apps/worker
RUN pnpm --filter @template/db exec prisma generate
RUN pnpm --filter @template/errors build
RUN pnpm --filter @template/db build
RUN pnpm --filter @template/events build
RUN pnpm --filter @template/worker build
# Strip devDependencies in place; workspace symlinks survive.
RUN pnpm install --frozen-lockfile --filter @template/worker... --prod --ignore-scripts

FROM node:24.15.0-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG GIT_SHA=""
ENV NODE_ENV=production \
    GIT_SHA=$GIT_SHA
COPY --from=build --chown=node:node /repo /app
USER node
# No EXPOSE — worker has no HTTP server. ECS health is the task being up.
# WORKDIR is /app (the workspace root); the CMD path is workspace-relative.
CMD ["node", "apps/worker/dist/index.js"]
