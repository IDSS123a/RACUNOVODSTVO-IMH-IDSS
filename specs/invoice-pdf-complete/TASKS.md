# TASKS — Accounting-complete invoice PDF (F1)

- [x] 1. Migration 012: default PDV note for an IMH row whose note is still empty, plus the seed default.
- [x] 2. Types — `RecapLine`, `InvoiceRecap` (`invoices/recap.ts`).
- [x] 3. Zod — *omitted* (no new IPC payload).
- [x] 4. Repository — *omitted* (no new command).
- [x] 5. Domain:
  - amount in words in the document's wording, with a cross-check test against `slova`;
  - `recap.ts` with a property test;
  - `code39.ts` with a decoder test;
  - due date + 5 days.
- [x] 6. Application — *omitted* (`pdf-actions` passes what it already loads).
- [x] 7. PDF layout to the reference: C1–C10; slip in the bottom third.
- [x] 8. Integration: render samples (one line, many lines, credit note, cancelled) and view them.
- [x] 9. Self-review.
- [x] 10. Tests (Director check pending): Vitest, cargo test (migration 012), visual check, then the Director in the running app (C-13).
- [x] 11. Docs: DL-P012, SPRINT note, lessons.
- [ ] 12. Commit; push and PR on the Director's approval.
