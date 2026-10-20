# SPRINT 01 — Skeleton, core data model, encrypted storage, pricing engine

**Status:** PLANNED · **Mode:** FULL · **Commander:** v1.6.2
**Depends on:** CONSTITUTION.md, DECISION_LOG.md (DL-P001…P005), docs/business-rules

---

## Goal

When this sprint is done, a fresh developer can clone the repository, install it and start the desktop app. The app opens an **encrypted** local database and shows the **official price lists** for 2025/26 and 2026/27 for both legal entities.

A fully tested **pricing engine** computes, for any family, the correct monthly (IMH) or annual (IDSS) amounts:
- with the sibling discount rule (same entity, younger child, BR-6);
- with mid-year starts (BR-12);
- with money rounding done in exactly one place (DL-P003).

## Why this order (M-2)

All later features depend on two things:
- one correct amount per child and item (invoices, PDF, ministry invoice, reminders, refunds);
- trustworthy storage.

UI comes later.

## IN scope

1. **Skeleton** — Tauri 2 + React + TypeScript strict + Vite, Tailwind + shadcn/ui, ESLint, Vitest. Feature folders per A-2:
   - `src/features/{settings,price-lists,families,billing}`;
   - `src/lib/validation/schemas.ts`;
   - `src/constants/index.ts`.
2. **Encrypted storage (DL-P004):**
   - SQLCipher via `rusqlite` with `bundled-sqlcipher`;
   - key in Windows Credential Manager (`keyring`);
   - recovery-key screen on first run;
   - numbered SQL migrations in `src-tauri/migrations/`, each with a rollback comment (A-6).
3. **Core schema — migration 001:**
   - `legal_entities`, `programs`, `school_years`, `price_lists`, `price_list_items`;
   - `families`, `children` (date of birth, citizenship flag), `enrolments` (child × program × school year, start/end date, status);
   - `board_decisions`, `ministry_approvals`, `settings`, `audit_log`.

   Invoices, payments and the subsidy cycle are **out of scope** (Sprint 02/03).
4. **Seed data with citations:**
   - institution master data from the letterheads;
   - price lists 2025/26 and 2026/27 (IMH Pravilnik/Cjenovnik, IDSS Pravilnik/Cjenovnik);
   - ministry approval record for 2026/27 (D16; number and date entered by the operator).
5. **Domain (pure TS, fully unit-tested):**
   - `money.ts` — fenings, basis points, a single rounding function, `formatKM()` for bs-BA output;
   - `pricing.ts` — price lookup, sibling ordering and discount tier (IMH: first/subsequent; IDSS: 1st/2nd/3rd+), pro-rata for a mid-year start, board-decision override hook (data only);
   - `price-cap.ts` — ≤10/5/3 % check vs. the previous year, plus the approval flag.
6. **Minimal UI:**
   - application shell (sidebar, light/dark tokens);
   - Settings (operator name/contact, institution data, backup folder);
   - read-only price-list viewer per school year and entity, with the price-cap check.
7. **Encrypted backup** to the folder from Settings, plus restore with a validation step.

## OUT of scope (later sprints)
- Families/children CRUD UI (Sprint 02).
- Invoices, PDF, payment plans, payments, reminders (Sprint 02–03).
- Ministry subsidy cycle, refunds (Sprint 04).
- Withdrawals/refund rules (Sprint 04).
- Import from the legacy HTML/JSON and Excel (Sprint 05).
- Installer signing, auto-update.

## Acceptance criteria
- [ ] `npm run build` and `cargo build` succeed with zero TypeScript and Rust errors. `npx tsc --noEmit` is clean.
- [ ] The database file on disk is unreadable without the key (verified by opening it with plain SQLite → fails).
- [ ] Price-list viewer amounts equal the source documents for **every** row (test compares to fixtures transcribed from the PDFs/DOCX).
- [ ] Pricing tests pass, including:
  - two IMH children, Toddlers 710 + IDSS Preschoolers younger → 710 + 600 = 1.310 KM;
  - three IMH children → full + subsequent + subsequent (never 0);
  - an IDSS 4th child → −15 %;
  - an IDSS mid-year start in January → 9.700 / 10 × 6 = 5.820 KM;
  - a sibling who leaves → the remaining child returns to full;
  - the IMH and IDSS sibling counts never mix;
  - the rounding cases 12,5 %, 7,5 % and x,xx5.
- [ ] Round-trip tests (save → load → compare) for every seeded entity (E-14).
- [ ] project-guard scan clean; DONE_CHECKLIST passed; handoff note written; `corrections/SPRINT_01_LESSONS.md` updated.

## Risks
- Rust/MSVC build tools on the Windows machine (Tauri prerequisites: WebView2 and the MSVC linker) must be verified first.
- SQLCipher bundled build time on Windows.

## Director decisions needed this sprint
- None expected. DL-P004 dependencies are confirmed in the handoff note.

---

HANDOFF NOTE — Sprint 01
Completed: —
Not completed: —
Open risks: —
Technical debt: —
Next sprint: Sprint 02 — Families, children, enrolments UI + invoices (IMH monthly, IDSS payment plans)
