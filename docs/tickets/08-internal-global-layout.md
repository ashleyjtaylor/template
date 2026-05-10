# 08 — `apps/internal` global layout (sidebar + theme + auth gate)

Replace the placeholder `__root.tsx` with a real signed-in layout for `apps/internal`: persistent sidebar nav, signed-in-as indicator, env+SHA badge, three-state theme switcher, sign-out. `/login` opts out of the chrome; `/` becomes a real Home route with TBD-widget placeholder.

## Goal

Today every page in `apps/internal` is a standalone shell. Login renders inside a useless `<h1>Internal Dashboard</h1>` wrapper, and signed-in pages each carry their own dot-grid backdrop, page padding, and inline 401-bounce. Once a second page lands (Manage staff, Customer browser, …) we'll need a sidebar, a way to sign out, and a way to know which environment / build you're looking at. This ticket lands all three before the second page.

## Acceptance criteria

- Signed-in users see a sidebar on every non-`/login` route. Sidebar contents:
  - Brand wordmark
  - Nav links (Home, Audit log)
  - Env + SHA badge (`${env} · ${sha8}`)
  - Signed-in-as email + role pill
  - Theme dropdown (Light / Dark / System)
  - Sign-out button
- Visiting `/login` while signed in → auto-redirects to `/`.
- Visiting any non-`/login` route while unauthed → bounces to `/login` (consolidates the per-page 401 `useEffect`s into one root-level check).
- Theme persists via `localStorage`; initial value respects `prefers-color-scheme` until toggled; `'system'` follows live OS changes.
- `/` is a real Home route showing a "TBD widgets" panel — sets the slot for the next PR.
- API `/health` returns `env` alongside `version`; the sidebar badge displays `${env} · ${sha8}`.
- Sign-out POSTs `/api/auth/sign-out` then bounces to `/login`.

## Module / file layout

```
apps/internal/src/
  modules/
    session/
      api.ts                 # useSession() — wraps GET /api/auth/get-session, refetch on focus
    theme/
      provider.tsx           # ThemeProvider — applies `dark` class to <html>, listens to prefers-color-scheme
      api.ts                 # useTheme() — { theme, setTheme } where theme = 'light' | 'dark' | 'system'
      ThemeToggle.tsx        # the dropdown component (uses shadcn DropdownMenu)
  components/
    layout/
      Sidebar.tsx            # cross-feature sidebar shell
      NavItem.tsx            # one nav link with active state
      EnvBadge.tsx           # env + sha8 pill
      UserMenu.tsx           # email + role + sign-out
  routes/
    __root.tsx               # rewritten — composes Sidebar, hides chrome on /login, runs auth gate
    index.tsx                # rewritten — Home page with TBD widgets placeholder
```

Audit list / detail routes lose their per-page 401 `useEffect` (now handled in layout).

## API + infra

- `apps/api/src/env.ts` — add `APP_ENV: z.enum(['development', 'staging', 'production']).default('development')`.
- `apps/api/src/lib/health.ts` (or wherever `/health` is defined) — add `env: env.APP_ENV` to the response. Schema gains an `env` field.
- `apps/api/test/integration/health.test.ts` — extend to assert `env` is present and equals `APP_ENV`.
- `infra/cdk/lib/app-stack.ts` — inject `APP_ENV: envName` into the API container's env block alongside `GIT_SHA`.

No new infra resources. No deploy-order change. No cost.

## Tests

- API: extend the existing `/health` integration test for the `env` field.
- SPA: no test setup today — scaffold vitest + jsdom for `apps/internal`. Cover the three-state theme provider:
  - Initial value follows `prefers-color-scheme` when nothing in localStorage.
  - `setTheme('system')` listens to live `matchMedia` change events.
  - `setTheme('light')` / `setTheme('dark')` ignore OS changes.
- No E2E (no Playwright today; defer until a second SPA is worth it).

## Out of scope (deferred — explicit follow-ups)

- **Sidebar collapse / responsive behaviour** — fixed-width day one; revisit at 5+ routes.
- **Per-role nav filtering** — all staff see all routes for now.
- **Home page widgets** — placeholder only; real widgets are their own PR.
- **Command palette / customer search.**
- **Session-expiry warning** (proactive "your session expires in 2 min").
- **Sidebar customisation, keyboard shortcuts, breadcrumbs.**

## Implementation chunking

~7–8 chunks, each a single-concern commit, stopping for review after each `git add`:

1. This ticket.
2. API: `APP_ENV` env var + `/health` returns `env` + test extension; CDK injects the var.
3. `modules/session/api.ts` + remove the per-page 401 `useEffect`s from audit list/detail.
4. `modules/theme/` (provider + hook + toggle component) + vitest + jsdom setup + theme tests.
5. `components/layout/` (Sidebar + sub-components, no behaviour yet — just visual).
6. `__root.tsx` rewrite (compose layout, auth gate, login chrome opt-out, signed-in `/login` redirect).
7. `routes/index.tsx` rewrite (Home with TBD widgets).
8. Doc catch-up (system-design `/health` field, endpoints, project_overview Home note, progress entry, css/react skills if patterns emerge).

Some chunks may collapse if tiny.
