# Staging tear-down and re-deploy

When you don't need staging running, tear it down to stop the ~$56/mo of NAT + ALB + Fargate billing. Re-deploy is automatic on the next push to `main`.

## Tear down

From a shell with AWS credentials configured:

```bash
pnpm --filter @template/cdk exec cdk destroy "template-staging-*"
```

CDK destroys in dependency order: app → data → network. Confirm the prompt for each stack (or pass `--force`).

What happens:
- ECR repo is emptied (`autoDeleteImages: true`) and deleted.
- CloudWatch log group `/ecs/template-staging-api` is deleted.
- ALB, target group, listener removed.
- ECS service drained, cluster deleted.
- NAT gateway, EIP, VPC, subnets, security groups all destroyed.
- After completion, AWS billing for these resources stops.

What's *not* destroyed:
- The `CDKToolkit` bootstrap stack (shared across deploys; leave it).
- The two `${PRODUCT}-deploy-{staging,production}` IAM roles created by the OIDC runbook (idle, no cost).
- ECR Scout findings history (free, retained by AWS).

## Re-deploy

The `deploy-network-data → build-api-image → migrate-db → deploy-app-stack → deploy-internal-spa → smoke` DAG (`build-internal-app` runs in parallel) lives in `.github/workflows/deploy-staging.yml` and is `workflow_dispatch`-only. Trigger after the green `ci.yml` check on the SHA you want to deploy:

```bash
gh workflow run deploy-staging.yml --ref main
```

Or: **Actions** tab → **deploy-staging** → **Run workflow** (branch `main`).

Staging is intentionally pull-based — pushes to `main` do not auto-deploy, so doc-only or template merges don't unintentionally restart torn-down infra. To switch back to push-driven later, change the `on:` block in `deploy-staging.yml` to `push: { branches: [main] }` (or add it alongside `workflow_dispatch:`).

The first re-deploy after tear-down takes ~5 minutes:
- ~1 min: `deploy-network-data` (NAT gateway is the slowest single resource at ~2 min on creation).
- ~1 min: `build-api-image` (uncached pnpm install in Docker).
- ~30 s: `build-internal-app` (parallel with the API path).
- ~30 s: `migrate-db` (Fargate task spin-up dominates).
- ~2 min: `deploy-app-stack` (Fargate rolling update + ALB target healthy).
- ~10 s: `deploy-internal-spa` (S3 sync + CloudFront invalidation).
- ≤ 1 min: `smoke` (poll loop usually exits on the first attempt once the rolling update completes).

## Verifying after re-deploy

Resolve the ALB DNS and curl `/health`:

```bash
ALB=$(aws cloudformation describe-stacks \
  --stack-name template-staging-app \
  --region eu-west-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`AlbDnsName`].OutputValue' \
  --output text)
curl -fsS "http://$ALB/health"
```

Expected: `{"status":"ok","version":"<commit-sha>","uptime":<seconds>}` where `version` matches the SHA you just pushed. (The smoke job in the workflow already does this; the manual curl is for sanity-checking outside CI.)

## Cost reference

| State                      | Approx monthly cost (eu-west-1) |
| -------------------------- | ------------------------------- |
| Torn down                  | ~$0 (only the bootstrap stack)  |
| Running 24/7               | ~$56 (NAT $32 + ALB $16 + Fargate $8) |

NAT gateway is the largest line item; tearing down is the single most effective cost-saving action when staging is idle.
