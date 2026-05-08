# 01 — `apps/api` with `/health`, deployed to staging end-to-end

Plan agreed via `/pre-feature` before implementation began.
Shipped via `feat/api-health` (PR #10) and `fix/ecr-lifecycle-rules` (PR #11).

## Requirements
- **Goal**: end-to-end automated deploy that proves the entire pipeline (CI → image build → ECR → CDK → ECS → ALB → live HTTP).
- **Acceptance**: `curl http://<ALB-DNS>/health` returns `200 application/json` with `{ status, version, uptime }` after a green push to `main`.
- **No domain, no TLS, no DNS** in this PR. Raw ALB DNS only.

## Data model
- **None.** No Prisma schema, no `packages/db`. Added with the first feature that has a domain entity.

## Routes / API
- `GET /health` — public (no auth), returns `200` with `{ status, version, uptime }`. Single endpoint.
- **No `packages/types`** entry. Single internal consumer; not worth scaffolding the package.
- **Errors**: no typed error classes yet. `packages/errors` arrives with the first feature that throws domain errors.

## App scaffold (`apps/api`)
- Hono server on Node, TypeScript, ESM, NodeNext.
- `apps/api/src/index.ts`: boot Hono, single `/health` route, `serve()` on `PORT` (default 3000).
- `process.env.GIT_SHA` injected at build time → returned as `version`. `uptime` from `process.uptime()`.
- Workspace package `@template/api`, scripts: `dev` (tsx watch), `build` (tsc to `dist/`), `start` (node dist/index.js), `typecheck` (tsc --noEmit), `test` (vitest run).
- Vitest configured at `apps/api/vitest.config.ts`. One test: boots the app, asserts `/health` returns 200 + correct shape.

## Dockerfile (`apps/api/Dockerfile`)
- Multi-stage: `deps` (pnpm install with `--filter @template/api...`), `build` (`pnpm --filter @template/api build`), `runner`.
- Base: `node:*-bookworm-slim` for glibc compatibility with future native npm prebuilds.
- Build arg: `GIT_SHA`. Runtime env: `NODE_ENV=production`, `PORT=3000`, `GIT_SHA` carried through.
- `USER node`, `EXPOSE 3000`, `CMD ["node", "dist/index.js"]`.
- **No Docker `HEALTHCHECK` directive.** ECS container health check + ALB target group health check do separate jobs — those are wired via CDK, not the Dockerfile.
- Build context: repo root. `.dockerignore` excludes `node_modules`, `.git`, `cdk.out`, `dist`, `.turbo`, `.vscode`, `*.md`.

## Infrastructure (CDK)

**NetworkStack** (`template-staging-network`)
- VPC, 2 AZs, public + private subnets.
- **Single NAT gateway** in one AZ.
- `albSg` (inbound :80 from internet), `ecsSg` (inbound :3000 from `albSg` only).

**DataStack** (`template-staging-data`)
- ECR repo `template-staging-api`. **One lifecycle rule per storage class** (TAGGED keep last 30, UNTAGGED expire after 1 day — ECR rejects two rules targeting the same status).
- `removalPolicy: DESTROY`, `autoDeleteImages: true`, `emptyOnDelete: true`.

**AppStack** (`template-staging-app`)
- ECS Fargate cluster.
- Task def: 0.25 vCPU / 0.5 GB, container `api` from `<ECR repo>:<imageTag>` (tag from CDK context `imageTag`), `PORT=3000`, `GIT_SHA=<imageTag>` env.
- ECS container health check: `node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`, interval 30s, timeout 5s, retries 3, startPeriod 60s.
- Fargate service: 1 desired task, in **private subnets** (no public IP), `ecsSg`, `circuitBreaker: { rollback: true }`, `minHealthyPercent: 0`, `maxHealthyPercent: 200`.
- Public ALB in public subnets, `albSg`, listener on **:80 only** (no HTTPS).
- Target group: HTTP, port 3000, health check `GET /health`, healthy 2, unhealthy 3, interval 30s, timeout 5s.
- CloudWatch log group `/ecs/template-staging-api`, 30-day retention, `removalPolicy: DESTROY`.
- `CfnOutput`: `albDnsName` for the smoke test.
- All stacks: `terminationProtection: false` explicitly. Tear down with `cdk destroy "template-staging-*"`.

**Production stacks**: defined in `bin/app.ts` (already are), use the same sizing as staging for now. Not deployed by this PR's workflow. Env-aware sizing arrives when prod actually deploys.

## CI/CD (`.github/workflows/ci.yml`)

Replace the current `deploy-staging` job with this DAG:

```
ci ──┐
cdk ─┼─→ deploy-infra ──→ build-image ──→ deploy-app ──→ smoke
```

- **`deploy-infra`** (`needs: [ci, cdk]`, push-to-main only, environment `staging`, OIDC): `cdk deploy template-staging-network template-staging-data --require-approval never`. Idempotent — no-ops on subsequent runs with no infra changes.
- **`build-image`** (`needs: [deploy-infra]`, OIDC): ECR login (`aws-actions/amazon-ecr-login`), `docker build --build-arg GIT_SHA=${{ github.sha }} -t $ECR_URI:${{ github.sha }} -f apps/api/Dockerfile .`, `docker push`. **Outputs**: `imageTag: ${{ github.sha }}`.
- **`deploy-app`** (`needs: [build-image]`, OIDC): `cdk deploy template-staging-app -c imageTag=${{ needs.build-image.outputs.imageTag }} --require-approval never`.
- **`smoke`** (`needs: [deploy-app]`, OIDC): fetch `albDnsName` from CFN outputs, `curl -fsS http://$ALB/health`, assert response contains `"version":"${{ github.sha }}"`. Job fails if non-200 *or* if the `version` doesn't match — so we catch "deploy succeeded but rolling update didn't actually swap the image".
- **No new secrets needed**. `AWS_DEPLOY_ROLE_ARN` already wired. OIDC role still has `AdministratorAccess` (tightening deferred per runbook).

## Testing
- **Vitest in `apps/api`**: 1 integration test against the Hono app — `app.fetch(new Request('http://x/health'))`, assert 200 + JSON shape.
- **Post-deploy smoke** (the `smoke` workflow job): real HTTP against the live ALB, asserts version matches the pushed sha.
- **No E2E in this PR**. Playwright lands when there's a frontend.

## Documentation
- New entry at top of `.claude/memory/progress.md` after merge.
- `project_overview.md` does not need updating — this PR doesn't change any architectural decision, just instantiates what's already designed.
- No new runbook needed.

## Out of scope (explicit)
- DNS, TLS, CloudFront, Route53, ACM
- RDS, Redis, S3, Secrets Manager
- `apps/worker`, `apps/web`, `apps/internal`
- Any `packages/*` (db, auth, errors, types, schemas)
- `deploy-production.yml`
- Tightening the OIDC role
- Promote-by-image cross-environment retag (the build/push is structured so this is one PR away when prod lands)
- `seed.ts`, `bootstrap-staff.ts`, docker-compose for local dev
- Sentry, pino logger (next ticket)
