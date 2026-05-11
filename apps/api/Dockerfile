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
# --ignore-scripts skips the root `prepare` (`lefthook install`, which needs a .git dir
# that doesn't exist in the build context) and esbuild's postinstall (vitest/biome are
# not run in the image, so no native binary needed).
RUN pnpm install --frozen-lockfile --filter @template/api... --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/errors ./packages/errors
COPY apps/api ./apps/api
# Workspace packages must be built before apps/api can resolve their `import`
# exports condition at runtime (typecheck reads `types` → src directly, but
# Node + tsx need the compiled `dist/index.js`).
RUN pnpm --filter @template/errors build
# Re-inject the now-built workspace packages into apps/api's node_modules so
# `pnpm deploy --prod` later copies a complete dist/ for each one. Without
# this, the initial install in the deps stage hard-linked an empty packages/
# tree (no dist existed yet).
RUN pnpm install --frozen-lockfile --filter @template/api... --ignore-scripts
# Generate the Prisma Client explicitly. The deps stage installs with
# --ignore-scripts so @prisma/client's postinstall (which normally runs
# `prisma generate`) is skipped — we have to invoke it ourselves once the
# schema files are in place.
RUN pnpm --filter @template/api exec prisma generate
RUN pnpm --filter @template/api build
# --ignore-scripts skips the root `prepare` (`lefthook install`); we don't want
# git hooks installed inside the container. Workspace-package injection is opted
# into via `injectWorkspacePackages: true` in pnpm-workspace.yaml.
RUN pnpm --filter @template/api deploy --prod --ignore-scripts /prod
# Re-generate the Prisma Client into the deployed node_modules. `pnpm deploy`
# creates a fresh node_modules in /prod with no .prisma artifacts, so without
# this step the runtime would fail on import. `prisma` is in runtime deps so
# the CLI is available in /prod/node_modules/.bin. prisma.config.ts ships
# alongside the schema so the migrator task can `prisma migrate deploy`.
RUN cp -r apps/api/prisma /prod/prisma && cp apps/api/prisma.config.ts /prod/prisma.config.ts
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
