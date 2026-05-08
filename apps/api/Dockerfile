# syntax=docker/dockerfile:1.7

# Node and pnpm versions must match the root package.json `engines` and `packageManager` fields,
# and the `node-version` / pnpm `version` inputs in .github/workflows/ci.yml.
# bookworm-slim (Debian/glibc) chosen over alpine for broader native-module compatibility
# (most npm prebuilds target glibc) and to avoid musl's DNS/threading edge cases.
FROM node:24.15.0-bookworm-slim AS base
RUN npm install -g pnpm@11.0.8
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY infra/cdk/package.json infra/cdk/
# --ignore-scripts skips the root `prepare` (`lefthook install`, which needs a .git dir
# that doesn't exist in the build context) and esbuild's postinstall (vitest/biome are
# not run in the image, so no native binary needed).
RUN pnpm install --frozen-lockfile --filter @template/api... --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
RUN pnpm --filter @template/api build
# --ignore-scripts skips the root `prepare` (`lefthook install`); we don't want
# git hooks installed inside the container. Workspace-package injection is opted
# into via `injectWorkspacePackages: true` in pnpm-workspace.yaml.
RUN pnpm --filter @template/api deploy --prod --ignore-scripts /prod

FROM node:24.15.0-bookworm-slim AS runner
WORKDIR /app
ARG GIT_SHA=""
ENV NODE_ENV=production \
    PORT=3000 \
    GIT_SHA=$GIT_SHA
COPY --from=build --chown=node:node /prod ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
