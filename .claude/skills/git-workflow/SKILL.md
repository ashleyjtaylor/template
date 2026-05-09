---
name: git-workflow
description: Branching, hooks, PR, and destructive-op rules for the trunk-based change cycle. Apply to every change. Use `/commit` for message format — not duplicated here.
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

**Commit messages**

Use the `/commit` skill — it parses the staged diff and drafts a Conventional Commits message that passes commitlint. The full format spec, type table, and don't-list live there. Don't restate them here.

**PR discipline**

When the user says "push" (or equivalent), `git push -u origin <branch>` AND `gh pr create` together with a populated title and body — `push` implicitly approves PR creation per the memory feedback. Body shape:

- `## Summary` — bullets, one per substantive change
- `## Test plan` — checklist of validation steps; tick items I verified, leave reviewer-only items unchecked
- `## Notes` — optional; reverted scope, deferred items, plan-vs-reality deltas
- Heredoc the body via `gh pr create --body "$(cat <<'EOF' ... EOF)"` so markdown survives.

Don't add Co-Authored-By trailers or "Generated with Claude Code" footers (existing memory rules).

**Hooks are not optional**

Pre-commit (Biome) and commit-msg (commitlint) hooks run via lefthook. Never skip them with `--no-verify` or `-c commit.gpgsign=false`. If a hook fails, fix the underlying issue.

**Destructive operations need explicit approval**

Never run without explicit, in-scope user confirmation:

- `git push --force` / `--force-with-lease` (especially on `main`)
- `git reset --hard`, `git restore .`, `git checkout -- .`
- `rm -rf` on anything outside a clearly-temporary build artifact
- `git rebase -i` or any history-rewriting operation
- `git branch -D` (force-delete unmerged branches)

When in doubt, surface the action and ask.
