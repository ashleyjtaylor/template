---
name: css
description: Apply CSS / styling conventions for SPAs — Tailwind 4 setup, shadcn primitives, design tokens, typography, layout, recurring visual patterns. Use when writing or reviewing any styling work in `apps/internal`, `apps/web`, or future SPAs.
---

Apply to all styling work in any SPA. The `react` skill covers components and data; this skill covers how things look and lay out.

## Tailwind 4

`apps/<spa>/src/index.css` is the single source of truth for tokens, fonts, and theme variants. Layout:

```css
@import url("https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;500;600&display=swap");
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root { --radius: 0.625rem; ...OKLCH neutral tokens... }
.dark { ...overrides... }

@theme inline {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif,
    "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
  --font-mono: "Source Code Pro", ui-monospace, monospace;
  ...radius + color mappings...
}
```

- **Colours**: OKLCH tokens only (per the shadcn neutral baseline). No raw hex / rgb in app code.
- **Variants**: `@custom-variant dark` enables `dark:` utilities; toggled by adding `dark` to a parent. No `next-themes` until a real theme switcher ships.
- **No version pins in CSS comments** — Tailwind / shadcn versions live in `package.json`.

## shadcn baseline

- **Style**: `new-york`. **Base colour**: `neutral`. Set once during `npx shadcn init`; do not change per-component.
- Primitives are **copy-pasted into `apps/<spa>/src/components/ui/`**, owned per app, modifiable. They are NOT an installed dependency.
- React 19 ref-as-prop primitives — no `forwardRef`. cva for variants.
- Add a primitive only when it has 2+ in-app consumers. Pre-installing the entire shadcn library is forbidden — every primitive added is one more file to maintain.

## Typography

Two font families, sharply scoped:

- **`font-sans`** (system stack) — labels, headings, paragraphs, navigation, **timestamps**, **action verbs**, every human-readable string.
- **`font-mono`** (Source Code Pro) — only on values that are literally codes or identifiers: `req_…` request IDs, `usr_…`/`aud_…`/`sess_…` entity IDs, IP addresses, `<pre>` JSON dumps, raw type:id composites (`user:usr_abc`).

The temptation is to make every "engineering" label mono. Resist it — the result is the typography variation the user explicitly pushed back on. **If the value is something a person reads, sans. If it's something a machine generated and you'd `git grep` for, mono.**

**No letter-spacing on uppercase labels.** The pattern `text-[10px] font-medium uppercase text-muted-foreground` (no `tracking-*` utility) is the canonical small-caps label. Letter-spacing reads as "tech aesthetic" — we removed it.

**Timestamps** use `tabular-nums` (so digit columns align) but not `font-mono`. Same for any other numeric column.

**No display fonts.** Geist sans, JetBrains Mono, etc. were tried and rejected — too much variation across pages. The system stack defers to the OS, which is what reads as "native staff tooling" rather than "marketing site."

## Layout — flex first

**Always reach for `flex` first. Only use `grid` when the layout is genuinely 2D — i.e. multiple rows that must share column widths.**

Concrete rules:

- One row of children, any direction, any wrapping → `flex`.
- One column of children → `flex flex-col`.
- A list of label/value pairs where each row stands alone → `flex` per row (e.g. `flex items-baseline gap-6` with the label fixed-width via `w-[110px] shrink-0` and the value `min-w-0 flex-1`).
- A table-like list where columns must align across rows → `grid` is correct (e.g. the audit-log row uses `grid grid-cols-[180px_minmax(180px,1fr)_minmax(220px,1.4fr)_minmax(160px,1fr)_120px]` because every row's "timestamp" column has to start at the same x-position).
- A card deck filling a 2D area → `grid` is correct.

If you can write the layout as flex without losing the visual, do so. Reaching for grid by default produces brittle column-width definitions that need re-tuning every time the data shape changes.

## Recurring visual patterns (from `apps/internal`)

When building a new SPA page, consider these patterns first instead of inventing equivalents:

- **Engineering dot-grid backdrop** — `pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,_var(--foreground)_1px,_transparent_0)] [background-size:24px_24px]` plus top + bottom 32px gradient fades to background. Keeps pages from feeling flat without resorting to imagery.
- **Single-pixel accent lines** — `absolute -top-px right-6 left-6 h-px bg-linear-to-r from-transparent via-foreground/30 to-transparent` for a card edge; `absolute inset-y-4 left-0 w-px bg-linear-to-b ...` for a "this is the inspected event" left-edge cue. Quiet, not decorative.
- **Small-caps utility labels** — `text-[10px] font-medium uppercase text-muted-foreground`. Used for column headers, field labels, status callouts. No tracking.
- **Card composition** — `rounded-lg border bg-card/60 shadow-xs`. Slight transparency on the card so the dot-grid bleeds through subtly.
- **Focus rings** — always `focus-visible:` (keyboard only), never `focus:` (sticky on click). Pair with `outline-none` to remove the browser default.
- **Status dot pills** — `<span aria-hidden className="size-1.5 rounded-full bg-{color}" />` next to a small-caps label. Used in the env+SHA badge (`prod=destructive`, `staging=yellow-500`, `dev=emerald-500`). One pixel of colour reads faster than a coloured background.
- **Tailwind 4 canonical class names** — prefer the new short names (`bg-linear-to-r`, `data-disabled:*`, integer spacing like `w-27.5`) over the legacy `bg-gradient-to-r` / `data-[disabled]:*` / `w-[110px]` arbitrary forms. The IDE Tailwind extension flags them; fix on touch.

## What not to do

- **No load-in / page-entry animations.** `animate-in fade-in slide-in-from-bottom-1 duration-500 fill-mode-backwards` reads as marketing-site polish on staff tooling. Hover and focus transitions are fine; whole-page reveals are not.
- **No emoji in UI strings.** Use lucide-react icons.
- **No `font-family` in inline styles or component-local CSS.** Sans/mono come from the `--font-sans` / `--font-mono` tokens via `font-sans` / `font-mono` utilities only.
- **No raw colour values in components.** Always go through the OKLCH tokens (`text-foreground`, `bg-card`, `border-border`, etc.).
- **No `@apply` in component CSS.** Tailwind utilities go on the JSX element. `@apply` is only used in `index.css`'s `@layer base` for global `border-border` / `outline-ring` defaults.
- **No `style={{ animationDelay: ... }}` chained reveals** — same reason as load-in animations.
- **No `biome-ignore` for `noLabelWithoutControl`.** The canonical fix is `useId()` + explicit `htmlFor`/`id` (see the `react` skill).

## Class ordering

Biome auto-sorts utility classes. Don't fight it. If a long class string looks unreadable, break the JSX onto multiple lines instead of resorting to `clsx` for static strings.

## Before adding a styling change, answer

- Is this a value a person reads (sans) or a code/ID (mono)?
- Can this layout be `flex` instead of `grid`?
- Does the colour come from an OKLCH token, not a raw hex?
- Is there an existing recurring pattern (dot-grid, accent line, small-caps label) I should match?
- Did I add letter-spacing to a label? Remove it.
