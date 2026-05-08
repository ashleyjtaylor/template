# 02 — `apps/api` foundations: logger, request ID, typed errors, security middleware, graceful shutdown

Plan agreed via `/pre-feature` before implementation began.
Shipped via `feat/api-foundations` (PR #14).

## Requirements
- **"Done" bar**: every request gets a request ID; every log line carries it; every error response has the typed wire shape; every response has security headers; CORS blocks unlisted origins; bodies > limit get 413; SIGTERM drains in-flight then exits 0.
- `/health` excluded from request logger (ALB probes every 30 s would drown signal).

## Data model
None.

## API design
- **Wire shape** for all errors: `{ code: string, message: string, details?: unknown }` (flat, no nested `error` key).
- **Six error classes** via base `HttpError`, in `apps/api/src/lib/errors.ts`:
  | Class | Status |
  |---|---|
  | `ValidationError` | 400 |
  | `UnauthorizedError` | 401 |
  | `ForbiddenError` | 403 |
  | `NotFoundError` | 404 |
  | `ConflictError` | 409 |
  | `InternalError` | 500 |
- `app.onError()` formats: `HttpError` → use class name as `code` + class status; Hono `HTTPException` → status-based code; anything else → 500 `{ code: "InternalError", message: "Internal server error" }` with original error logged.
- No tRPC yet; this is plain Hono. tRPC arrives with the first typed route.

## Middleware order in `createApp`
```
requestId → requestLogger → secureHeaders → cors → bodyLimit → routes → onError
```

## New files
- `apps/api/src/lib/logger.ts` — pino instance (JSON in prod, pretty in dev) + AsyncLocalStorage helpers (`getRequestId()`, `runWithContext()`)
- `apps/api/src/lib/errors.ts` — `HttpError` base + six subclasses + `formatError()`
- `apps/api/src/middleware/request-id.ts` — generates UUID via `crypto.randomUUID()` (Node built-in, no dep), seeds ALS context, sets `X-Request-Id` response header. Prefix the ID with `req_` per the project's prefixed-ID convention.
- `apps/api/src/middleware/request-logger.ts` — logs on completion (`{ method, path, status, duration }`), skips `/health`
- `apps/api/src/middleware/error-handler.ts` — the `onError` callback
- `apps/api/src/lib/shutdown.ts` — registers SIGTERM/SIGINT hook that calls `server.close()` and waits up to `SHUTDOWN_TIMEOUT_MS`

## Modified files
- `apps/api/src/app.ts` — `createApp` wires the middleware chain in order
- `apps/api/src/index.ts` — registers the shutdown hook on the returned `serve()` instance
- `apps/api/src/env.ts` — adds 4 vars (defaults below)
- `apps/api/src/app.test.ts` — adds 8 integration tests (existing 2 stay)
- `apps/api/package.json` — adds `pino`, `pino-pretty` (dev-only), `zod`
- `infra/cdk/lib/app-stack.ts` — `stopTimeout: Duration.seconds(30)` on the API container + comment

## Env vars (all in `env.ts` with defaults)
| Var | Default | Type |
|---|---|---|
| `LOG_LEVEL` | `'info'` | enum: `trace`/`debug`/`info`/`warn`/`error`/`fatal`/`silent` |
| `CORS_ORIGINS` | `''` | comma-separated, parsed to `string[]` |
| `BODY_LIMIT_BYTES` | `1048576` (1 MB) | int |
| `SHUTDOWN_TIMEOUT_MS` | `25000` (25 s) | int |
| `NODE_ENV` | `'development'` | enum: `development`/`production`/`test` (drives pino pretty vs JSON) |

## Infrastructure
No new AWS resources. One CDK change: explicit `stopTimeout: Duration.seconds(30)` on the API container with a comment that it must stay ≥ `SHUTDOWN_TIMEOUT_MS` (the cross-file invariant).

ALB's `deregistrationDelay: 30s` already exists in the target group and works alongside.

## Testing
- **Unit**: error class formatting (one test per class) + `getRequestId()` returns same ID across awaits + shutdown handler drain/timeout/error paths.
- **Integration** (against `app.request()`):
  1. `/health` → 200 with existing shape (regression).
  2. Test route throwing `NotFoundError` → 404 + `{ code: "NotFoundError", … }`.
  3. Test route throwing plain `Error("secret")` → 500 + `{ code: "InternalError", message: "Internal server error" }`, original logged.
  4. Every response carries `X-Request-Id` (matches `^req_[0-9a-f-]{36}$`).
  5. Security headers present (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).
  6. CORS preflight from allowlisted origin → 200 + `Access-Control-Allow-Origin`; from unlisted → no CORS headers.
  7. POST body > limit → 413 with formatted error.
  8. `/health` log line absent (assert via captured pino stream).
- **Tests add their own throwing routes** on the returned Hono app — no factory parameter for test-only behaviour.
- **Graceful shutdown**: unit test on the handler (calls `close`, awaits, exits). No real-SIGTERM integration test.

## CI/CD
No new workflow steps. The existing `ci`, `cdk`, `docker-build`, and the deploy chain all cover this PR's surface.

## Documentation
- `progress.md` — new entry on merge.
- `docs/system-design.md` — no update (no infra topology change).
- `project_overview.md` — no update (matches existing design).
- No new runbook (no manual ops introduced).

## Out of scope (deferred)
Rate limiting, tRPC, Sentry, auth middleware, audit log, OpenTelemetry, `packages/errors` extraction (lands when worker arrives).
