# TASKS — Storno, credit notes and payment correction

*From PLAN.md. Order per FEATURE_LIFECYCLE Step 3. Each step is verified before the next.*

## Phase 1 — data and backend
- [x] 1. Migration 010:
  - rebuild `invoices` (`credits_invoice_id`, `reason`, relaxed CHECKs);
  - `credit_note_sequences` (seeded from legacy KO numbers);
  - `payment_reversals`;
  - `credit_movements`.
  - Plus the E-19 migration test on a database holding legacy and app data.
- [x] 2. Rust types for the credit-note draft, reversal, movement and family credit.
- [x] 3. Zod schemas in `src/lib/validation/schemas.ts`.
- [x] 4. Rust repository `credit_notes.rs`:
  - numbering `{entity}-KO-{nnn}/{yy}`;
  - issue, reverse, move, link;
  - effective balance in the summary query;
  - the legacy import writes `credit_note_sequences`.
- [x] 5. TS domain `credit-notes.ts`:
  - draft from selection;
  - remaining per line;
  - effective balance;
  - family credit;
  - `summarisePayments` delegates.
- [x] 6. Commands and TS repository/actions.

*Phase 1 verified 2026-11-21:*
- *cargo test 47/47, including migration 010 under data of every kind (E-19) and 7 credit-note tests for S1–S6;*
- *Vitest 182/182; tsc, ESLint and project-guard clean;*
- *real-data end to end: 1.569 invoices, 251 findings, credit-note series IDSS 2026 = 35, 0 FK violations.*
- *Call sites already use the effective balance: invoice list, invoice detail, PDF open amount.*

## Phase 2 — screens and documents
- [ ] 7. UI:
  - credit-note dialog;
  - payment reversal;
  - family credit (move / refund);
  - „Poveži s računom“ in „Za provjeru“;
  - credit-note PDF.
- [ ] 8. Integration: invoice list and detail show net / effective paid / „STORNIRAN“; monthly billing re-offers fully cancelled months (S6).

## Phase 3 — close
- [ ] 9. Self-review (Step 4).
- [ ] 10. Testing:
  - Rust and Vitest per acceptance criterion;
  - real-data end-to-end (L-S3-08), including linking a legacy KO;
  - Director check in the running app (C-13).
- [ ] 11. Documentation: DECISION_LOG DL-P011, SPRINT_04 notes, lessons.
- [ ] 12. Commit, PR, merge after the Director's approval.
