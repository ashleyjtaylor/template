---
name: commit
description: Draft a Conventional Commits message for currently staged changes. Triggered by `/commit`.
---

Run these in parallel:
1. `git status` — what's staged.
2. `git diff --cached` — the staged content.
3. `git log --oneline -10` — match this repo's commit style.

If nothing is staged, say so and stop.

Draft a message in Conventional Commits format:

```
<type>(optional scope): <description>

[optional body]

[optional footer]
```

**Types** (this repo uses `@commitlint/config-conventional`):

| Type | When |
| --- | --- |
| `feat` | New user-facing feature |
| `fix` | Bug fix |
| `chore` | Tooling, deps, build — no behaviour change |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only |
| `test` | Adding or fixing tests |
| `perf` | Performance improvement |
| `build` | Changes to build system or dependencies |
| `ci` | Changes to CI config |
| `revert` | Revert a previous commit |

**Subject rules**
- Imperative mood (`add X`, not `added X` or `adds X`).
- ≤ 72 chars.
- No trailing period.
- Lowercase after the colon.
- Scope optional; use it when the change is localised: `feat(auth): add Google OAuth`.

**Body** — wrap at 72 chars; explain *why*, not *what* (the diff shows what).

**Breaking changes** — add `!` after the type/scope (`feat!:` or `feat(api)!:`) AND a `BREAKING CHANGE:` footer.

**Don't**
- Don't squash unrelated changes; suggest splitting if the staged diff covers multiple concerns.
- Don't reference task / PR numbers in the subject; use a footer (`Refs: ABC-123`) if needed.
- Don't run `git commit` yourself unless the user explicitly confirms — propose the message and the exact `git commit` command for them to invoke.

For the surrounding workflow (branching, hooks, PR discipline, destructive-op approval), see the `git-workflow` skill.
