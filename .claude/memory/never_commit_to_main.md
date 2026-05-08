---
name: never_commit_to_main
description: Never commit directly to main. Always branch first, even for one-line fixes. Trunk-based development means PRs for everything.
type: project
---

Before any `git commit`, verify you are on a feature branch — `git branch --show-current` must not return `main`. If it does, `git checkout -b <type>/<slug>` first. This applies even to:

- One-line config fixes
- Reverts of broken deploys
- Renovate-style version bumps
- "Surely this is fine" tooling tweaks

**Why:** trunk-based development with mandatory PR review is the chosen workflow for this template. Direct-to-main commits skip the review gate, the CI gate, the build-image gate, and the documented PR audit trail. They also create awkward recovery problems: force-push to `main` is off-limits, so an accidental main commit can only be cleaned up with a revert-PR-then-redo-PR pair, which is more work than just having branched correctly the first time.

**Specific failure mode to watch for:** finishing one feature, the branch gets merged, the local `main` is synced, and *then* a follow-up fix is needed. At this moment the muscle memory of "I'm working" tries to commit on the current branch — but the current branch is now `main`. Always re-check `git branch --show-current` after a merge before the next commit.

**How to apply:** the very first action of any new commit cycle is `git checkout -b <branch>`. The branch name follows the existing repo convention (`feat/`, `fix/`, `docs/`, `ci/`, `chore/`). Only after the branch exists do you start editing files / committing / pushing.
