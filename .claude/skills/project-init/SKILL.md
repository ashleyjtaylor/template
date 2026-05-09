---
name: project-init
description: Initial project scoping interview, run once at project start. Output saved to `.claude/memory/project_overview.md`. Triggered by `/project-init`.
---

Interview me relentlessly about every aspect of the project until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer. Surface anything I haven't thought of or have missed in my initial ideas.

Ask questions one at a time.

Once we've worked through the full design, write the agreed overview to `.claude/memory/project_overview.md` and add a link from `.claude/MEMORY.md`.

For ongoing per-feature design conversations, use the `pre-feature` skill instead — this skill is for the first-time scoping pass only.
