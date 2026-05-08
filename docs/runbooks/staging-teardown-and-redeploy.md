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

The `deploy-infra → build-image → deploy-app → smoke` workflow runs on every push to `main`. Re-deploying after a tear-down is just any push:

```bash
git commit --allow-empty -m "chore: redeploy staging"
git push
```

> **Note (current dev state):** while the template is still being scaffolded and staging gets torn down between dev sessions, the deploy DAG is gated on `workflow_dispatch` instead of `push`. Trigger from the **Actions** tab → **ci** → **Run workflow** (branch `main`), or `gh workflow run ci.yml --ref main`. Revert the `if:` conditions on the deploy jobs back to `github.event_name == 'push' && github.ref == 'refs/heads/main'` once you want continuous deploy.

The first re-deploy after tear-down takes ~5 minutes:
- ~1 min: `deploy-infra` (NAT gateway is the slowest single resource at ~2 min on creation).
- ~1 min: `build-image` (uncached pnpm install in Docker).
- ~2 min: `deploy-app` (Fargate task pull + start + ALB target healthy).
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
