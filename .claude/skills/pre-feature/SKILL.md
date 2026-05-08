---
name: pre-feature
description: Interview the user about a planned feature before writing any code. Covers requirements, data model, API design, error cases, tests, and dependencies. Use before starting any non-trivial feature.
---

Before writing a single line of code, interview me about this feature. Work through each area below one question at a time. If a question can be answered by reading the codebase, read it instead of asking.

**Requirements**
- What is the user-facing goal? Who triggers this and what do they get back?
- What are the acceptance criteria — how do we know it's done?
- What are the edge cases and failure modes I haven't mentioned?

**Data model**
- What new tables, columns, or relations are needed?
- What constraints, indexes, or cascade rules apply?
- What existing data is affected — migrations, backfills, breaking changes?

**API design**
- What routes are needed (method, path, auth requirement)?
- What does the request body look like? What does the response look like?
- What shared types need to be added to the types package?

**Error handling**
- What validation errors can the caller make (400)?
- What auth or permission errors apply (401/403)?
- What business rule violations need specific error codes (409, 422)?
- How do we handle non-happy paths?

**Integration points**
- What external services are involved (email, SMS, payments, storage, queues)?
- What happens if those services are unavailable — fail, retry, or degrade?
- Does this feature touch existing modules that might regress?

**Testing plan**
- What are the unit test cases for the service layer?
- What are the integration test cases for each HTTP endpoint (happy path + each error class)?
- What E2E test scenarios needs to be outlined?
- What external I/O should be mocked vs real?

**System Design and Infrastructure**
- What infrastructure resource needs to be created for this feature? (if any)
- What is impacted by adding this resource - deploy order, costs?
- Is Redis viable?
- Can it be a separate async job or use event-driven architecture?

**CI/CD**
- What GitHub actions need to be implemented?
- What environment variables need setting up?
- How are we going to deploy the project?
- How will the Dockerfile need to work?

Once we've answered everything, summarise the full plan — data model, routes, types, infrastructure, error codes, and test cases — before I start implementing.

**After the user signs off on the plan**, save the exact plan summary to `docs/tickets/NN-<kebab-slug>.md` where `NN` is the next zero-padded sequential number (look at existing files in `docs/tickets/` to find the next one) and the slug is a short feature name (e.g. `03-database-setup.md`). The file is the durable record of what was agreed before code was written; future sessions can read it to understand intent independent of what eventually shipped.

**Ship the ticket with the implementation PR, not as a separate docs PR.** Create the ticket file as the first commit on the feature branch, then build the feature in subsequent commits on the same branch. Reviewers see plan + implementation together, no extra PR cycle, no risk of the ticket landing on `main` for a feature that never ships. The only exception is genuinely retroactive backfills (plans agreed before this convention existed) — those can land in their own docs PR.
