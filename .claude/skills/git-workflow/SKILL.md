---
name: git-workflow
description: Branching, committing, and PR conventions for this repo. Trunk-based with mandatory PR review. Apply to every change cycle.
---

This repo is trunk-based: `main` is always deployable; every change lands via a short-lived feature branch and a PR.

**Always branch first**

Before any `git commit`, verify you are on a feature branch — `git branch --show-current` must NOT return `main`. If it does, `git checkout -b <branch>` first. This applies to every change including:

- One-line config fixes
- Reverts of broken deploys
- Renovate-style version bumps
- "Surely this is fine" tooling tweaks

The most common slip is finishing one feature, the branch gets merged, you sync `main`, then a follow-up fix is needed and muscle memory tries to commit on the current branch — which is now `main`. Always re-check after a merge.

Force-push to `main` is off-limits. An accidental main commit can only be cleaned up via a revert PR plus a redo PR — more work than branching correctly the first time.

**Branch naming**

`<type>/<kebab-slug>`, where `<type>` matches the Conventional Commits set: `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`, `perf/`, `build/`, `ci/`, `revert/`. Slugs are short and descriptive. Examples: `feat/api-health`, `fix/ecr-lifecycle-rules`, `docs/post-deploy-updates`, `ci/manual-staging-deploy`.

**Stop after `git add`**

The end of any change cycle is `git add`. Do not run `git commit`, `git push`, or `gh pr create`. Report the staged change set (branch name, files, summary) and wait for explicit approval before any of those.

The flow is:

1. Branch: `git checkout -b <branch>`
2. Edit files
3. Stage: `git add <files>` (or `git add -A`)
4. **Stop.** Report the staged set + branch name + summary.
5. Wait for the user to say "go" / "commit and push" / "ship it" / similar
6. Then commit + push

This applies to every commit, including follow-ups on a branch that already has earlier commits.

**PR discipline**

Don't run `gh pr create` automatically. After pushing the branch, stop. The user opens the PR (or explicitly asks you to). PRs are public artifacts; the user controls timing, body wording, and review batching.

When the user does ask for a PR, the body shape:

- `## Summary` — bullets, one per substantive change
- `## Test plan` — checklist of validation steps
- Related context — failure logs, runbook links, run URLs

**Conventional Commits**

Commit messages are enforced by commitlint via the `commit-msg` hook. Use the `/commit` slash command to draft a message — it parses the staged diff and matches this repo's style.

- Subject ≤ 72 chars, imperative mood, lowercase after the colon, no trailing period.
- Body wraps at 72 chars; explain *why*, not *what* (the diff shows what).
- Don't reference task / PR numbers in the subject; use a footer (`Refs: ABC-123`) if needed.
- Don't squash unrelated changes; suggest splitting if the staged diff covers multiple concerns.

**Hooks are not optional**

Pre-commit (Biome) and commit-msg (commitlint) hooks run via lefthook. Never skip them with `--no-verify`. If a hook fails, fix the underlying issue.

**Destructive operations need explicit approval**

Never run without explicit, in-scope user confirmation:

- `git push --force` / `--force-with-lease` (especially on `main`)
- `git reset --hard`, `git restore .`, `git checkout -- .`
- `rm -rf` on anything outside a clearly-temporary build artifact
- `git rebase -i` or any history-rewriting operation

When in doubt, surface the action and ask.
