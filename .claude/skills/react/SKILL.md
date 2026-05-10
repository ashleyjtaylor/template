---
name: react
description: Apply React + SPA conventions — module structure, file-based routing, data fetching, error UX, component patterns. Use when building or reviewing any frontend code in `apps/internal`, `apps/web`, or future SPAs.
---

Apply to all SPA work. The `css` skill covers styling and layout; this skill covers components, data, and structure. Conventions in `code-style` (types, comments, error handling, whitespace) apply here too.

## Module structure

SPAs mirror the API's vertical-slice layout. Each feature owns its schemas, types, sub-components, and hooks under `src/modules/<feature>/`. Cross-feature infra (the API client, query client, error class, shadcn primitives) sits at the SPA root.

```
apps/<spa>/src/
  modules/
    <feature>/                # one folder per domain feature (audit-log, settings, …)
      schemas.ts              # Zod schemas + `z.infer` types — the single source of truth
      api.ts                  # query/mutation hook factories (useAuditLogList, useAuditLogDetail)
      components/             # feature-only components (FilterField, RowItem, DetailContent, …)
      utils.ts                # pure helpers (formatTs, splitAction)
  routes/                     # TanStack Router file-based entries; pages live here, importing from modules
  components/ui/              # shadcn primitives, copy-pasted, owned per app
  lib/                        # cross-module infra (api wrapper, query client, ApiError)
  index.css
  main.tsx
```

**The route file IS the page.** TanStack Router's file-based routing forces routes into `src/routes/`. Don't fight it — the route file defines the page component and imports schemas, sub-components, and hooks from its module. Don't extract a one-line glue file in `routes/` just to put the page in `modules/`.

**Promote to a module when**: a schema, type, helper, or sub-component is consumed by ≥ 2 route files. A single-route helper stays inline in the route file.

**Cross-module imports go through `modules/<feature>`**, not into `<feature>/components/` directly. The module's public surface is what the folder root re-exports.

**Shared modules across SPAs.** When a domain-agnostic module (`session`, `theme`) is needed in a second SPA, **duplicate first** and extract to `packages/<name>/` once both copies actually exist — same package-extraction-at-second-consumer rule as `packages/*` everywhere else. Drawing the package boundary against a single consumer is guesswork; against two it's informed. `apps/web` and `apps/internal` currently each carry their own `modules/session/` and `modules/theme/` for exactly this reason.

## File-based routing (TanStack Router)

- Route files live at `apps/<spa>/src/routes/<path>.tsx`. Dot-notation creates parent/child layouts. Trailing underscore on a segment opts out of nesting (`audit_.$entityId.tsx` is a flat sibling of `audit.tsx`, not a child) — useful when two pages share a URL prefix but not a layout.
- Use `createFileRoute('/path')({ component: PageName })`. Don't wrap pages in extra glue.
- Typed search params via `validateSearch: zodSchema` on the route definition. Read with `Route.useSearch()`. Update with `navigate({ to, search })` — TanStack merges or replaces based on the function form.
- Use `Link` from `@tanstack/react-router` for in-app navigation, never raw `<a>` (no client-side routing). `useNavigate()` for programmatic moves.

## Data fetching

- **TanStack Query is the only data primitive.** No raw `fetch` in components, no SWR, no Redux Query.
- Every request goes through the `api(path, schema, options?)` wrapper at `src/lib/api.ts`. The wrapper:
  - Sets `credentials: 'include'` so the better-auth cookie rides on every call.
  - Validates the response with the supplied Zod schema at the boundary, throwing `ApiError` on a mismatch.
  - Throws `ApiError` with `status`, `code`, and `message` on non-2xx — never returns a partial response.
- Hooks live in `modules/<feature>/api.ts` as factories: `useAuditLogList(search)`, `useAuditLogDetail(entityId)`. Routes call the hook, not `useQuery` directly.
- **Schemas live in `modules/<feature>/schemas.ts`** with their inferred types as siblings (`export type AuditLogRow = z.infer<typeof auditLogRowSchema>`). One file is the source of truth for both the validator and the type.

## Global layout + auth gate

`__root.tsx` owns the cross-page chrome (sidebar, header, modals) and the auth gate. One pattern, one place:

- **Sidebar / chrome** lives in `components/layout/{Sidebar,NavItem,EnvBadge,UserMenu}.tsx`. Cross-feature, mounted at the root.
- **AuthGate** is a single component inside `__root.tsx` that calls `useSession()` once and runs all redirect logic — unauthed → `/login`, signed-in-on-`/login` → `/`. Renders `null` while the session query is loading or while the redirect effect is mid-flight, so the user never flashes a protected page or login screen before the redirect lands.
- **Per-page 401 `useEffect`s are not needed** once the root gate exists; delete them. The gate is the single redirect path; `useSession()`'s `refetchOnWindowFocus: true` catches mid-session expiry on tab refocus.
- **Unauthed routes** (today: `/login`) opt out by listing in a `UNAUTHED_PATHS` `Set` in `__root.tsx`. The gate skips redirecting on those, and the layout renders a bare `<Outlet />` instead of the sidebar.
- **Global providers** (theme, query client) live at `main.tsx`, wrapping `<RouterProvider />`. `__root.tsx` is the *layout* root; `main.tsx` is the *provider* root.

## Error UX

Every page handles four error classes consistently. `ApiError.status` discriminates:

| Status | UI |
|---|---|
| `401` | `useEffect(() => navigate({ to: '/login' }))` — bounce, render nothing |
| `403` | In-page block: "Staff access required" or domain-specific equivalent |
| `404` | In-page block with the short-id of the missing resource and a link back |
| `5xx` | `friendlyError(err)` returns a generic message; render with a Retry button (`refetch()`) |

Don't wrap each call in a try/catch — TanStack Query's `error` field is the single read. Gate UI on `query.isError && query.error instanceof ApiError && query.error.status === 403` etc.

## Loading states

Render a **`SkeletonBlocks`** component that mirrors the real layout to avoid layout shift. Skeletons use the same flex / grid scaffolding the real content does, with shadcn `<Skeleton />` filling each cell. Don't show a centred spinner on a card-based page — the layout jump is jarring.

## Component patterns

- **No `forwardRef`.** React 19 passes `ref` as a normal prop. shadcn primitives are written this way; new components follow.
- **Form labels**: `useId()` + explicit `htmlFor` on the label and `id` on the input. The biome rule `noLabelWithoutControl` is non-negotiable; the canonical fix is `useId`, never `// biome-ignore`.
- **Variants**: cva for shadcn-style primitives. For ad-hoc one-off variants in a single component, conditional class strings are fine — don't reach for cva for two states.
- **Composition over options**: prefer rendering children into a slot (`<Card><CardHeader>…</CardHeader></Card>`) over a giant `props` object on a single component. shadcn's split-component pattern is the model.
- **Icons**: lucide-react only. Use the `size-3` / `size-4` utilities; don't pass `width`/`height` props.

## State

- Server state: TanStack Query (covered above). Cache invalidation via `queryClient.invalidateQueries({ queryKey })` — list keys include the filter object so refetching after a mutation works automatically.
- URL state: TanStack Router search params (filters, pagination cursors, selected tab). Anything a refresh should preserve goes here.
- Local UI state: `useState`. No Zustand / Jotai / Redux until a real cross-component need appears.
- Theme / auth / global preferences: a single `lib/<topic>-context.tsx` provider mounted at the root. Don't pre-create providers for hypothetical needs.

## Tests — unit only (no integration tier)

SPAs ship `apps/<spa>/test/unit/` only. There is **no `integration/`** sibling, intentionally:

- The boundaries that matter for a SPA are the real browser DOM, real HTTP, and real user input. jsdom-based "integration" tests cover little that typecheck doesn't already, while pretending to test something they aren't.
- The middle tier between unit and end-to-end on the frontend is **Playwright**, not vitest + jsdom. When the SPA is mature enough to justify the harness, E2E user-flow tests land at `apps/<spa>/e2e/` (not `test/integration/`).

The backend (`apps/api`) is the opposite — `test/integration/` is dense because HTTP → service → DB roundtrips are where real bugs live. Don't mirror that structure on the SPA.

What to unit-test on the SPA:
- Pure helpers (formatters, splitters, validation).
- Hook logic with non-trivial branches (the `ThemeProvider`'s system / explicit / persisted load is the canonical example).
- Anything the typecheck can't prove.

What not to unit-test:
- Markup ("does this component render this string"). Brittle, low value.
- Static props plumbing. Typecheck owns this.
- TanStack Query / Router internals. Trust the library.

## What not to do

- **No emoji** in UI strings — see `css` skill.
- **No `as` casts** outside Zod-validated boundaries — see `code-style`.
- **No `useEffect` for data fetching.** That's `useQuery`. The only `useEffect` justified in a route file today is the 401-bounce.
- **No props drilling 3+ levels deep.** If a value crosses three components, lift it to a context or a query.
- **No "page wrapper" components** unless they actually share styling. The dot-grid backdrop is repeated three lines of JSX in every page on purpose — extracting it into a `<PageShell>` saves nothing and makes the layout less greppable.
- **No `localStorage` reads on the render path.** Hydrate from storage in a `useEffect` and write back on change; never read directly during render (causes hydration bugs even in CSR-only apps once SSR ships).

## Before adding a frontend change, answer

- Does this belong in a feature module (`modules/<feature>/`) or in the route file (single-use)?
- Is data fetching going through `useQuery` + the `api` wrapper, with a Zod schema?
- Are error states handled for all four classes (401 / 403 / 404 / 5xx)?
- Is the loading state a layout-matching skeleton, not a spinner?
- Did I reach for `useEffect` when `useQuery` would do?
