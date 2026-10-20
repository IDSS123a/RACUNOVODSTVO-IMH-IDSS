---
name: tasks
description: Write the TASKS.md for a feature that already has a PLAN.md — ordered implementation checklist. Third step of the spec→plan→tasks layer, feeds FEATURE_LIFECYCLE Step 3. Invoke once PLAN.md exists (/tasks).
---

# /tasks — Implementation Checklist (feeds FEATURE_LIFECYCLE Step 3)

Reads `specs/[feature-name]/PLAN.md` (stop and ask if it doesn't exist
yet — run `/plan-feature` first) and produces
`specs/[feature-name]/TASKS.md`: an ordered checklist that maps
directly onto `FEATURE_LIFECYCLE.md` Step 3's implementation order.
Do not reorder or skip layers — each task depends on the one above it
being complete and tested.

**Write `TASKS.md` in this shape:**

```markdown
# TASKS — [Feature Name]

- [ ] 1. Database migration (if new tables/columns) — `PLAN.md` Data Model
- [ ] 2. TypeScript types — `types/index.ts` or `features/[name]/types.ts`
- [ ] 3. Zod validation schema — `lib/validation/schemas.ts`
- [ ] 4. Repository function — `features/[name]/repository.ts`
- [ ] 5. Domain logic — `features/[name]/domain.ts`
- [ ] 6. Server Action / API route — per PLAN.md's E-6 sequence
- [ ] 7. UI component — `features/[name]/components/`
- [ ] 8. Integration — wire UI to Server Action
- [ ] 9. Self-review — FEATURE_LIFECYCLE.md Step 4 checklist
- [ ] 10. Testing — FEATURE_LIFECYCLE.md Step 5 (all roles, failure
      paths, mobile, loading/error states)
- [ ] 11. Documentation — FEATURE_LIFECYCLE.md Step 6
- [ ] 12. Commit and handoff — FEATURE_LIFECYCLE.md Step 7
```

Omit a numbered step only if `PLAN.md` explicitly says that layer
isn't touched (e.g. a UI-only change skips 1–3, per
FEATURE_LIFECYCLE.md's own "Scope by size" note) — state which steps
were omitted and why, don't silently drop them.

This file is the actual input to implementation: check items off as
you go, don't hold progress in session memory alone (same rationale
as M-18 — the filesystem survives context compaction, memory doesn't).
