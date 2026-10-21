# SPRINT 01 — Skeleton, core data model, encrypted storage, pricing engine

**Status:** DONE — 2026-10-21 (Director walkthrough approved) · **Mode:** FULL · **Commander:** v1.6.2
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
- [x] `npm run build` and `cargo build` succeed with zero TypeScript and Rust errors. `npx tsc --noEmit` is clean. `cargo clippy -D warnings` is clean.
- [x] The database file on disk is unreadable without the key. Verified by test (`store::file_on_disk_is_not_plain_sqlite`) and on the live dev run: the file starts with `FKIDB`, not `SQLite format 3`.
- [x] Price-list amounts equal the source documents. `seed.test.ts` checks them against independently transcribed fixtures and checks the documents' own rounding rules.
- [x] Pricing tests pass:
  - 710 + 600 = 1.310 KM;
  - three IMH children are never free;
  - an IDSS 4th child gets −15 %;
  - an IDSS January start costs 5.820 KM;
  - a sibling who leaves → the remaining child returns to full;
  - IMH and IDSS are never mixed;
  - rounding at 12,5 %, 7,5 % and x,xx5.
- [x] Round-trip tests (E-14) for institutions, price items, approvals, settings and the encrypted store.
- [x] project-guard scan clean; lessons updated.
- [x] Director's visual walkthrough: operator profile, price list, price-cap check and settings approved (2026-10-21).
- [ ] Release installer (`npm run tauri build`) — moved to Sprint 02.

## Risks
- Rust/MSVC build tools on the Windows machine (Tauri prerequisites: WebView2 and the MSVC linker) must be verified first.
- SQLCipher bundled build time on Windows.

## Director decisions needed this sprint
- None expected. DL-P004 dependencies are confirmed in the handoff note.

---

HANDOFF NOTE — Sprint 01
Completed:
- Skeleton (Tauri 2, React 19, TS strict, Vite 6, Tailwind 4, shadcn/ui radix-nova, RHF + Zod).
- Encrypted storage: in-memory SQLite, AES-256-GCM snapshots, DPAPI-protected key, recovery key, migration 001.
- Domain: money (fenings, single rounding), pricing (sibling tiers per entity, pro-rata, board decisions), price-cap check.
- Seeds: price lists 2025/26 and 2026/27; institution data from the letterheads.
- UI: start-up flow (recovery key → operator profile), price-list viewer with sources, IMH price-cap panel with ministry approval record, settings (operator, institutions, backup/restore).
- Tests: 46 TypeScript + 15 Rust, all green.
Not completed:
- Release installer build.
Open risks:
- If the Windows account or profile is lost, the database can only be recovered with the printed recovery key. Restore-with-recovery-key exists in Settings, but there is no UI path yet when the key file itself is missing at start-up (the app shows an error). → Sprint 02.
- Test data: the dev test database, key and WebView cache on the Director's computer were deleted on 2026-10-21 after the walkthrough (DONE_CHECKLIST: no test data left behind).
Technical debt:
- The price list is read-only in the UI. Adding a new school year needs a maintenance screen (Sprint 05).
- The JS bundle is about 1 MB (desktop, loaded from disk — acceptable).
Next sprint: Sprint 02 — families, children and enrolments (CRUD with sibling order shown), IMH monthly invoices and IDSS payment plans, invoice PDF.

COMMANDER COMPLIANCE — Sprint 01
──────────────────────────────────
Rules followed without reminder:        22/24
Rules violated, caught by ACA:          2 (E-12-class: synthetic input hit another app — stopped and recorded; M-12: shadcn CLI put itself into dependencies — moved to devDependencies)
Rules violated, caught by Director:     0 in this sprint (bootstrap-phase corrections recorded separately in lessons)
Rules that slowed work or felt wrong:   none
New rules suggested by this sprint:     no synthetic OS input on a shared desktop; inspect reused repos for secrets before adoption; `gh` availability check first in bootstrap
