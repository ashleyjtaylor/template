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
# --ignore-scripts skips the root `prepare` (`lefthook install`, which needs a .git dir
# that doesn't exist in the build context), @prisma/client's postinstall (we run
# `prisma generate` explicitly below), and esbuild's postinstall.
RUN pnpm install --frozen-lockfile --filter @template/worker... --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/errors ./packages/errors
COPY packages/db ./packages/db
COPY packages/events ./packages/events
COPY apps/worker ./apps/worker
# Workspace packages must be built before apps/worker can resolve their
# `import` exports condition at runtime.
RUN pnpm --filter @template/errors build
# Generate the Prisma Client FIRST — packages/db's tsc imports `PrismaClient`
# from `@prisma/client`, which only exists after `prisma generate` runs. The
# deps stage installs with --ignore-scripts so the postinstall is skipped;
# we invoke it explicitly here before building @template/db.
RUN pnpm --filter @template/db exec prisma generate
RUN pnpm --filter @template/db build
RUN pnpm --filter @template/events build
# Re-inject the now-built workspace packages into apps/worker's node_modules
# so `pnpm deploy --prod` later copies a complete dist/ for each one.
RUN pnpm install --frozen-lockfile --filter @template/worker... --ignore-scripts
RUN pnpm --filter @template/worker build
RUN pnpm --filter @template/worker deploy --prod --ignore-scripts /prod
# Re-generate Prisma into /prod since `pnpm deploy` creates a fresh
# node_modules with no .prisma artifacts.
RUN cp -r packages/db/prisma /prod/prisma && cp packages/db/prisma.config.ts /prod/prisma.config.ts
RUN cd /prod && node_modules/.bin/prisma generate

FROM node:24.15.0-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG GIT_SHA=""
ENV NODE_ENV=production \
    GIT_SHA=$GIT_SHA
COPY --from=build --chown=node:node /prod ./
USER node
# No EXPOSE — worker has no HTTP server. ECS health is determined by the task
# being up (no port mapping, no ALB target group).
CMD ["node", "dist/index.js"]
