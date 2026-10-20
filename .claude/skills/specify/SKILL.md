---
name: specify
description: Write the SPEC.md for a new feature — what and why, no tech stack. First step of the spec→plan→tasks layer (FEATURE_LIFECYCLE Step 1). Invoke with a feature description (/specify).
---

# /specify — Feature Specification (FEATURE_LIFECYCLE Step 1)

Produces `specs/[feature-name]/SPEC.md` — the record of WHAT the
feature is and WHY, deliberately excluding HOW. Kebab-case the
feature name per E-9 (e.g. `document-upload-pipeline`).

**Before writing anything:** if the feature description leaves any of
the following unstated, STOP and ask the Director — per M-4, never
invent business rules, user roles, or institutional constraints:

- Who uses this feature and what problem it solves for them
- Which user roles can access it and what each role can/cannot do
- The explicit scope boundary — what this feature does NOT do
- Acceptance criteria: how anyone verifies this is done

**Write `SPEC.md` in this shape:**

```markdown
# SPEC — [Feature Name]

## Purpose
[Institutional purpose — who benefits, what problem this solves.
Ties to M-1 CTO Principle: not "what to build" but "why this,
now."]

## User Stories
- As a [role], I can [action], so that [outcome].
  (one per role that touches this feature)

## Acceptance Criteria
- [ ] [Specific, testable condition]
- [ ] [Specific, testable condition]

## Explicitly Out of Scope
- [What this feature does NOT do — the boundary, per
  FEATURE_LIFECYCLE Step 1]

## Open Questions
- [Anything still unresolved — do not silently assume an answer]
```

**Hard rule:** no tech stack, no database schema, no API routes, no
component names anywhere in `SPEC.md`. If you catch yourself writing
an implementation detail, move it to a mental note for `/plan-feature`
and cut it here — this is exactly the separation Commander's own
rules (M-2 Architectural Thinking Order: vision before architecture)
already require; this skill just gives it a durable artifact instead
of leaving it as session reasoning.

When done, tell the Director the file is ready and that `/plan-feature`
is the next step.
