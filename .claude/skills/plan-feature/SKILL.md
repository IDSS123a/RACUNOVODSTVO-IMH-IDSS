---
name: plan-feature
description: Write the PLAN.md for a feature that already has a SPEC.md — technical approach against Commander's architecture rules. Second step of the spec→plan→tasks layer (FEATURE_LIFECYCLE Step 2). Invoke once SPEC.md exists (/plan-feature).
---

# /plan-feature — Technical Plan (FEATURE_LIFECYCLE Step 2)

Reads `specs/[feature-name]/SPEC.md` (stop and ask if it doesn't exist
yet — run `/specify` first) and produces
`specs/[feature-name]/PLAN.md`: the technical HOW, constrained by
Commander's existing architecture rules rather than starting from a
blank slate. This is the integration point where Commander is
stricter than a generic spec-plan-tasks flow — the plan inherits the
full rule set automatically.

**Before writing, check the plan against:**
- `ARCHITECTURE_PATTERNS.md` A-1 (Five Layers) through A-10 (FK
  deletion patterns) — every touched layer must follow its pattern
- `ENGINEERING_RULES.md` E-1–E-13 — TypeScript strictness, Zod
  boundaries, security requirements, the E-3/E-11 accepted
  alternatives (AUDIT-003), whatever else applies
- The project's own `DECISION_LOG.md` for any stack deviation already
  approved (M-16)

If the plan would require breaking a 🔴 CRITICAL rule, STOP and
surface the conflict to the Director instead of silently working
around it — do not resolve a Constitution conflict by improvising.

**Write `PLAN.md` in this shape:**

```markdown
# PLAN — [Feature Name]

## Architecture
[Which of the five layers (A-1) this touches, and how — Domain,
Infrastructure, Application, Presentation, per the existing pattern.]

## Data Model
[New/changed tables, columns, relationships. FK deletion behavior
explicit per A-10 — including the AI-generated-content addendum if
relevant.]

## API / Server Actions
[Routes or Server Actions, each following the E-6 sequence:
authenticate → authorise → validate → execute → return.]

## Rule Constraints Applied
[Explicit list: which Commander rules shaped a specific decision
here, and why — e.g. "E-2: DocumentUploadSchema in
lib/validation/schemas.ts" — not generic advice, the actual rule ID.]

## Risks / Deviations
[Anything that deviates from a Commander default, with the
DECISION_LOG.md entry it's recorded under (M-16).]
```

When done, tell the Director the file is ready and that `/tasks` is
the next step.
