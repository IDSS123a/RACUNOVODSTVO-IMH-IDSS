# TASKS — Storno, credit notes and payment correction

*From PLAN.md. Order per FEATURE_LIFECYCLE Step 3. Each step is verified before the next.*

## Phase 1 — data and backend
- [ ] 1. Migration 010:
  - rebuild `invoices` (`credits_invoice_id`, `reason`, relaxed CHECKs);
  - `credit_note_sequences` (seeded from legacy KO numbers);
  - `payment_reversals`;
  - `credit_movements`.
  - Plus the E-19 migration test on a database holding legacy and app data.
- [ ] 2. Rust types for the credit-note draft, reversal, movement and family credit.
- [ ] 3. Zod schemas in `src/lib/validation/schemas.ts`.
- [ ] 4. Rust repository `credit_notes.rs`:
  - numbering `{entity}-KO-{nnn}/{yy}`;
  - issue, reverse, move, link;
  - effective balance in the summary query;
  - the legacy import writes `credit_note_sequences`.
- [ ] 5. TS domain `credit-notes.ts`:
  - draft from selection;
  - remaining per line;
  - effective balance;
  - family credit;
  - `summarisePayments` delegates.
- [ ] 6. Commands and TS repository/actions.

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
