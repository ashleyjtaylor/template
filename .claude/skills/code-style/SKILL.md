---
name: code-style
description: Apply consistent code style and engineering standards to a file or module. Covers comments, error handling, types, naming, and what not to add. Use when reviewing or writing code.
---

Apply these rules to the code in scope. Fix violations. Do not change behaviour.

**Frontend specifics live elsewhere.** This skill is the cross-language baseline. For SPA work see the `css` skill (Tailwind 4 + shadcn, layout, typography) and the `react` skill (components, routing, data fetching, module structure).

**Formatting is automatic.** Biome is the source of truth (single quotes, no trailing commas, semicolons as-needed). Don't argue with it; don't override per-file. Run `pnpm format` if a file looks off.

**File organization**

Every TypeScript file is laid out top-down in this order:

1. Imports (Biome auto-sorts: `node:*` → external → internal/relative)
2. Top-level constants
3. Types and interfaces
4. Module-private helpers
5. Main exports

Don't scatter constants between functions or place imports after code. The structure makes "what does this module own" answerable at a glance.

**Comments**

Write no comments by default. Add one only when the WHY is non-obvious: a hidden constraint, a workaround for a specific bug, a subtle invariant. If removing the comment would not confuse a future reader, delete it.

Never write:
- Comments that restate what the code does (`// create user`)
- Reference comments that describe the caller or task (`// used by signup flow`, `// added for issue #42`)
- Multi-line docstrings or block comments on internal functions

**Cross-file invariants** are an exception — they *are* the WHY. When two files must stay in sync (e.g. `SHUTDOWN_TIMEOUT_MS` in `apps/api/src/env.ts` must stay below the ECS `stopTimeout` in `infra/cdk/lib/app-stack.ts`; URL-composition logic duplicated between `env.ts` and `prisma.config.ts`), put a comment in **each** file naming the other. The next person editing one of them sees the link.

**Types**

Use string union types, not enums or const objects with runtime values:
```ts
// correct
export type Status = 'pending' | 'active' | 'cancelled'

// wrong — runtime value gets stripped by bundlers when a name has both export const and export type
export const Status = { PENDING: 'pending' } as const
```

Shared domain types live in `packages/types`. Validation schemas (Zod) live in `packages/schemas`. Don't duplicate either across apps.

Type-only imports use `import type` (required by `verbatimModuleSyntax` in `tsconfig.base.json`):
```ts
import type { User } from '@template/types'
import { signAccessToken } from '@template/auth'
```

Prefer `unknown` over `any`. If you reach for `any`, narrow it at the boundary instead.

Avoid `as` type assertions except at validated boundaries (after a Zod parse, after `instanceof`). Inline assertions hide bugs.

**`||` vs `??`**

Pick deliberately — they differ on `0`, `''`, and `false`:

- **`||`** treats every falsy value (`null`, `undefined`, `0`, `''`, `false`, `NaN`) as "missing" and falls through to the right-hand side.
- **`??`** only catches `null` and `undefined`. `0`, `''`, and `false` pass through.

Use `||` when those falsy values should mean "missing" — e.g. `process.env.GIT_SHA || 'unknown'` (Docker `ENV X=` results in an empty string, which we want to treat as unset).

Use `??` only when `0` / `''` / `false` are legitimate values — e.g. `count ?? 10` where `0` is a real count.

The wrong choice produces silent data corruption. Picking `??` for env vars lets `''` through as a "real" value, which then leaks into logs and responses.

**Constants over magic literals**

Extract a numeric or string literal as a named const when:

- It appears in 2+ places (e.g. `APP_PORT = 3000` referenced from middleware, CDK, and the Dockerfile).
- Its meaning isn't obvious from context (e.g. `PROBE_TIMEOUT_MS = 2_000` reads better than a bare `2_000` inside `Promise.race`).
- It's a configuration knob someone might want to tune.

Single-use literals with self-evident meaning (`return c.json(body, 200)`, `throw new Error('boom')`) stay inline.

**Error handling**

Use typed error classes from `packages/errors`, not plain `Error` or generic HTTP exceptions:
```ts
throw new ConflictError('Email already in use')
throw new UnauthorizedError('Invalid credentials')
throw new NotFoundError('Job not found')
```

Only validate and handle errors at system boundaries (user input, external APIs). Trust internal function contracts — do not add defensive checks for things that cannot happen.

**Naming**

- Functions: verb phrases that describe what they do (`createUser`, `signAccessToken`)
- Booleans: `is`, `has`, `can` prefix (`isVerified`, `hasExpired`)
- No abbreviations unless universally understood (`db`, `id`, `url` are fine; `mgr`, `svc`, `hlpr` are not)
- Test names start with `should` and describe behaviour, not the unit (`should return 404 when the user is missing`, not `getUser handles missing`).
- Prefixed IDs follow Stripe-style truncated `prefix_<id>` for any identifier the system generates (`req_…`, `usr_…`, `sess_…`, etc.). Convention, registry, and database-side details live in the `database` skill — see there before adding a new prefix.

**Whitespace within functions**

Use blank lines to separate logical phases. Specific rules:

- **`if` / `for` / `while` / `switch`** — blank line above and below. Exceptions: skip the blank above if it's the function's first statement; skip the blank below if no further code follows the closing brace.
- **`const` / `let` declarations** — blank line below, unless the next statement is also a `const` / `let`. Group related declarations together, then break before the next phase.
- **`return`** — blank line above, unless `return` is the only line in the function body.
- **General principle** — most statements get breathing room above and below; only group when statements logically belong together (sequence of related variable declarations, tight chain of method calls being constructed, etc.).

Example (handler):

```ts
export const handler: Handler = async (c) => {
  const body = await c.req.json()
  const validated = schema.parse(body)

  if (await exists(validated.email)) {
    throw new ConflictError('Email already in use')
  }

  const user = await createUser(validated)

  return c.json(user, 201)
}
```

In Hono handlers, bind the awaited value to a `const` before calling `c.json`. Don't inline the await — `c.json(await createUser(...))` is rejected style. The named bind documents what's being returned and keeps the value inspectable in a debugger.

Tests follow the same shape (arrange / act / assert each separated by a blank line).

**API module layering**

Backend modules under `apps/api/src/modules/<feature>/` split into four files by role:

- **`routes.ts`** — Hono route definitions. Zod-parses inputs, awaits the controller into a `const`, returns `c.json(result)`. **No Prisma imports, no business logic.** Throws `ValidationError` on schema failure; everything else is the controller's job.
- **`controllers.ts`** — orchestration between validated input and services. Decodes/encodes wire shapes (e.g. cursors), combines service calls, shapes responses, decides 4xx semantics like 404-when-row-missing.
- **`service.ts`** — every Prisma query plus any pure business logic (state-machine transitions, last-owner checks, transactional flows). Returns plain DB rows or domain values; knows nothing about HTTP.
- **`schemas.ts`** — Zod input/output schemas + the small codec helpers attached to those wire shapes.

Domain helpers (`permissions.ts`, `tokens.ts`, `events.ts`) sit alongside as needed.

Even when a controller is a thin pass-through, keep the layer — consistency beats saving 2 lines on simple endpoints. On review, flag any `prisma.*` import inside `routes.ts`, or any Hono routing inside `service.ts`, as a layering violation.

**Authz**

No inline role checks. Every authorisation decision goes through `assertCan(membership, 'resource:verb')` from `packages/auth`. Action strings follow `resource:verb` convention (e.g. `'members:invite'`, `'org:manage'`).

**Logger calls**

`pino` takes structured fields in the first arg, a human-readable message in the second:

```ts
logger.info({ method, path, status, durationMs }, 'request')
logger.warn({ err, timeoutMs }, 'health/ready: db probe timed out')
```

CloudWatch Logs Insights queries the first-arg fields directly (`{ $.requestId = "abc" }`); the message is for humans skimming logs. Putting fields *inside* the message string (`logger.info(\`request \${path} \${status}\`)`) makes them ungreppable.

**What not to add**

- No feature flags or backwards-compatibility shims unless explicitly asked
- No error handling for scenarios that cannot happen in the current code path
- No helper abstractions for fewer than three call sites
- No logging of every operation — log failures and non-obvious decisions only via the shared `pino` logger
- No `console.log` — Biome warns on it

**After applying changes**

Run `pnpm lint && pnpm typecheck`. Fix all errors before reporting done.