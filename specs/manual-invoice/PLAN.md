# PLAN — Manual invoice (F2)

*FEATURE_LIFECYCLE Step 2 · see SPEC.md*

## Layers
1. **Migration 013** `invoice_lines.quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999)` and `invoice_lines.unit TEXT CHECK (unit IS NULL OR unit IN ('kom','srv'))`. Both columns are additive; rollback = restore the backup. A rehearsal test applies 001–013 to a database seeded at 012.
2. **Rust `invoices.rs`**
   - `InvoiceLine` gets `quantity` (serde default 1) and `unit` (default None); both are inserted and read back.
   - `InvoiceDraft` gets `reason` (default ""), stored in `invoices.reason`.
   - `issue_invoice` validates the SPEC rules for kind `OTHER`.
   - `get_invoice` returns quantity and unit, and the summary returns the reason (already selected).
3. **TS types and Zod** `InvoiceLine.itemCode: PriceItemCode | 'OTHER'`, optional `quantity` and `unit`; `InvoiceDraftSchema.reason`.
4. **Domain `invoices/manual.ts`** `buildManualInvoice(detail, input)` → `InvoiceDraft` or `InvoiceError`. It is pure and holds every M5 message, plus the enrolment lookup (M1), the period and the default due date.
5. **Recap** quantity and unit from the line when present, else 1 and the derived unit. The price and discounted values are per unit, and the net amount is per line.
6. **Monthly bulk** `prepareMonth`: app `OTHER` invoices do not mark a child as billed.
7. **UI** `ManualInvoiceDialog.tsx`, opened from „Računi“ with a „Novi račun“ button. It has a family / child picker, month, dates, basis, item rows with add and remove, live totals, and a note pointing to the price-list flows (M8). After creating it opens `InvoicePdfDialog`. The detail dialog shows „Osnov“.
8. **Tests**
   - Vitest for `manual.ts`: every validation, entity from the enrolment, fenings exact, property Σ.
   - Recap with quantity.
   - PDF render with quantity 3.
   - `prepareMonth` billed set.
   - cargo: issue OTHER happy path and every rejection, quantity round-trip, migration 013 rehearsal.
9. **Docs** DL-P013, matrix F2 ✅ with the M3/M8 decisions, SPRINT note.

## Risks
- `InvoiceLine` is shared by every builder. The new fields are optional in TS and defaulted in Rust, so the existing builders and credit notes compile unchanged.
- Do not edit migration 013 once `tauri dev` has applied it (L-S3-11): write and test it with cargo in a separate target dir **before** saving it under `migrations/`, while the dev app is stopped.
