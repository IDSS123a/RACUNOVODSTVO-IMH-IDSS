# CLAUDE.md — Fakturisanje IMH & IDSS
# Commander-Governed Project

---

## GOVERNANCE — TIERED LOADING (M-21)

This project is governed by **Commander v1.6.2**
(github.com/IDSS123a/commander). The 🔴 CRITICAL rules are inlined
below and always apply. Do NOT bulk-load full Commander documents at
session start. Read a full document only when the task enters its
domain:

| Read on demand | When |
|---|---|
| ENGINEERING_RULES.md | before implementation work (Tier 2) |
| ARCHITECTURE_PATTERNS.md | before structural/schema decisions (Tier 2) |
| ACA_COMMUNICATION_PROTOCOL.md (C-1–C-5) | output/format questions (Tier 2) |
| FEATURE_LIFECYCLE.md + DONE_CHECKLIST.md | at sprint close |
| PROMPT_LIBRARY/* | when the Director invokes that ritual |

Base URL: `https://raw.githubusercontent.com/IDSS123a/commander/main/`

**Always read (small, project-specific):**
- Project Constitution: `CONSTITUTION.md` — wins over Commander for this project
- Project decisions: `DECISION_LOG.md`
- Current sprint: `sprints/SPRINT_XX.md` (currently `sprints/SPRINT_01.md`)
- Business rules (authoritative, cited): `docs/business-rules/ANALIZA-POSLOVNIH-PRAVILA-porodice-3plus.md`

---

## 🔴 CRITICAL RULES — ALWAYS IN FORCE

Compressed here for zero-fetch loading. The full text in CONSTITUTION.md /
ENGINEERING_RULES.md governs on any doubt.

**Mindset (M):**
- **M-1 CTO Principle** — act as CTO, not task-executor. Every decision must survive the test: "maintainable and understandable by the next ACA with no extra context?"
- **M-2 Thinking Order** — vision → architecture → domain → data → API → feature → component → code. Never UI-first, never skip.
- **M-3 Decision Hierarchy** — institution rules > security > data integrity > architecture consistency > performance > developer convenience > UI > visuals.
- **M-4 Anti-Hallucination** — never invent endpoints, tables, env vars, services, roles, prices, discounts or policies. If something is not specified → STOP and ask.
- **M-5 Layered Architecture** — exact layer order, never mix, never skip.
- **M-7 Single Source of Truth** — every fact lives in exactly one place.
- **M-10 Context Insufficiency** — missing context is stated, never guessed around.
- **M-15 Confidentiality Propagation** — data about children and parents is protected on EVERY surface: code, comments, commits, logs, filenames, docs, exports.
- **M-21 Tiered Loading** — this file implements it. Reference docs (DECISION_LOG, ACA_MANAGEMENT_GUIDE, CLAUDE_CODE_OPERATIONS) are never session-start reads.
- **M-22 KRAJ Protocol** — on "KRAJ": collect corrections → analyse → propose COMMANDER_UPDATE_PROPOSAL.md → wait for approval → only then touch the commander repo.

**Engineering (E) — read the full rules before heavy code work:**
- **E-1 TypeScript** — strict, no `any`, no `@ts-ignore`.
- **E-2 Zod** — validate every boundary; schemas only in `src/lib/validation/schemas.ts`.
- **E-4 Security** — secrets never in code; the database is encrypted at rest; Excel/CSV exports are formula-injection safe.
- **E-5 Error Handling** — every async op in try/catch; no silent failures; standard `{ success, ... }` result shapes.
- **E-6 Command Sequence** — validate (Zod) → execute (domain) → persist (repository) → return. The app has a single operator, so it has no authentication or role layer (see DECISION_LOG DL-P002).

---

## LESSON CAPTURE (M-18 — hook-enforced)

The `lessons-guard` hook blocks session end if files changed without
lessons captured. Append to `corrections/SPRINT_XX_LESSONS.md`
**immediately** when:
- the Director corrects you;
- an environment gotcha bites;
- a rule-violation bug appears;
- a course correction happens;
- a Commander improvement candidate surfaces.

Entry format: PROMPT_LIBRARY/sprint-lessons.md. Consolidate at sprint
close per DONE_CHECKLIST.md.

---

## AUTOMATION LAYER (hooks — deterministic, zero-token)

Installed in `.claude/`:
- `version-check.js` (SessionStart) — warns on Commander version drift.
- `log-change.js` + `project-guard.js` (PostToolUse) — auto-log every
  edit. project-guard BLOCKS forbidden patterns per E-13
  (config: `.claude/project-guard.config.json`).
- `lessons-guard.js` + `patterns-detect.js` (Stop) — enforce lesson
  capture and pre-compute rule recurrence for KRAJ.

Treat guards as allies, not obstacles. Session memory is unreliable,
the filesystem is not (M-18).

**ACAs without hook support:** run
`node .claude/hooks/project-guard.js --scan` before every commit
(E-13 graceful degradation).

---

## PROJECT-SPECIFIC NOTES

- **Stack deviation (M-16):** offline Windows desktop app built with
  Tauri 2, React, TypeScript (strict) and Vite, on an encrypted local
  SQLite database. This is not Next.js + Supabase. See DECISION_LOG
  DL-P001.
- **Single operator:** Financijsko-administrativni menadžer. The
  operator's name and contact live ONLY in the app settings (database),
  never in code (project-guard enforces this).
- **Two legal entities, never mixed:** IMH (Toddlers, Preschoolers,
  IDSS Preschoolers) and IDSS (primary school I–IX). Every amount, every
  invoice and every discount belongs to exactly one legal entity.
- **Money:** always integer fenings (1 KM = 100), rounded per line,
  exactly once, in `src/features/billing/money.ts`. Floating-point
  money anywhere else is a bug.
- **Institution is never short-changed:** invoices are always issued at
  the price-list amount. A reduction is allowed only through the
  automatic sibling discount from the price list or a recorded board
  decision. The ministry subsidy never reduces an invoice.
- **Communication with the Director:** in Bosnian. Code, commits and
  technical docs: in English.

---

*Commander v1.6.2 — IDSS123a Organisation — Davor Mulalić*
