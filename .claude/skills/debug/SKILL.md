---
name: debug
description: Systematically debug a problem. Covers how to narrow the scope, verify assumptions, add diagnostic logging, and avoid common traps. Use when facing a persistent or unclear bug.
---

Stop guessing. Work through this process.

**Step 1 — State what you know for certain**

Write out:
- The exact error message and where it appears (log line, stack trace, browser console)
- The last thing that worked
- What changed between working and broken

If any of these are unknown, find them before continuing.

**Step 2 — Identify which layer is failing**

For a request that fails end-to-end, narrow it down:
- Does the request reach the server? (check access logs)
- Does the server receive it at the right route? (check request logs)
- Does the service layer throw? (check error logs with full detail, not just code)
- Does the database query fail? (check DB-level errors)
- Does the response reach the client correctly? (check network tab)

Each "yes" eliminates a layer. Stop at the first "no" — that is where the bug is.

**Step 3 — Verify your assumptions**

Most persistent bugs are caused by assuming something is true without checking. Common ones:
- "The env var is set" → log it (sanitised) or check the deployed config directly
- "The secret was updated" → verify it AND verify the service restarted after the update
- "The code was deployed" → check the running version/timestamp, not just that the deploy ran
- "The config was saved" → re-read it from the source of truth, not from memory

**Step 4 — Add diagnostic logging, then deploy**

If you cannot reproduce locally, add temporary logging that surfaces the exact state:
- Log the full error object (message + meta + cause), not just the error code
- Log the values being used for the failing operation (sanitise secrets: log host/db, not password)
- Add a startup connectivity check so failures surface immediately, not on the first request

Deploy, reproduce, read the logs. Do not guess at a fix until the logs confirm the cause.

**Step 5 — Fix one thing at a time**

Change one variable per attempt. If you change two things and it works, you don't know which fixed it and you may have introduced a silent regression.

**Common traps to avoid**

- Fixing the symptom not the cause (e.g. retrying on failure instead of fixing why it fails)
- Assuming the latest code is running (caches, stale builds, ECS tasks not restarted)
- Reading error codes without reading error messages (P1010 tells you category; the message tells you why)
- Skipping verification steps because "that can't be it" — check anyway
