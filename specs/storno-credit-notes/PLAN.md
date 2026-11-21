# PLAN — Storno, credit notes and payment correction

*FEATURE_LIFECYCLE Step 2 · from SPEC.md (S1–S6) · Commander v1.8.1 · checked against CONSTITUTION.md*

## Architecture (A-1)
- **Domain** — new file `src/features/invoices/credit-notes.ts`, pure TypeScript with tests.
  - Builds a credit-note draft from the operator's choice (whole invoice / chosen lines / part of a line).
  - Computes the remaining creditable amount per line.
  - Computes the **effective balance** of an invoice: net total, valid payments, credit moved in and out, open amount, credit.
  - Computes the family credit per institution.
  - The existing `summarisePayments` becomes a thin wrapper of the new balance function (M-7: one place).
- **Infrastructure (Rust)** — numbering, validation and persistence in one transaction each (as BR-23):
  - `credit_notes.rs` (new): `issue_credit_note`, `reverse_payment`, `move_credit`, `link_legacy_credit_note`;
  - `invoices.rs`: the summary query returns net total and effective paid.
- **Application** — `actions.ts` / `repository.ts`, with Zod for every payload (E-2).
- **Presentation**
  - Invoice detail:
    - „Knjižno odobrenje…“ dialog;
    - „Storno uplate…“ on every payment;
    - credit-note history.
  - Family detail: „Kredit porodice“ per institution, with „Prebaci na račun…“ and „Povrat roditelju…“.
  - „Za provjeru“: „Poveži s računom…“ on the finding „Knjižno odobrenje bez veze“ (S5).
  - Credit-note PDF: title „KNJIŽNO ODOBRENJE“, original invoice number and date, reason, no payment slip.

## Data Model — migration 010 (001–009 are never edited)

### `invoices` (rebuilt — the 008 procedure: foreign keys OFF, `foreign_key_check` must be empty)
- New column `credits_invoice_id TEXT REFERENCES invoices(id) ON DELETE RESTRICT` — the invoice a credit note cancels.
  - Required for credit notes issued in the app.
  - NULL for the 3 legacy ones until linked (S5).
- New column `reason TEXT NOT NULL DEFAULT ''` — required for app credit notes.
- CHECK relaxed so app credit notes may be negative:
  - `source='LEGACY' OR kind='CREDIT_NOTE' OR total_fenings >= 0`;
  - plus `kind <> 'CREDIT_NOTE' OR total_fenings < 0`;
  - plus `source='LEGACY' OR kind <> 'CREDIT_NOTE' OR (credits_invoice_id IS NOT NULL AND length(trim(reason)) > 0)`.
- The status `CANCELLED` is set on the original **when its net total reaches 0** (full credit).
  - The existing partial unique indexes (`status='ISSUED'`) then allow re-issuing for the same child and month (S6), with no new rule.

### `credit_note_sequences(entity, year, last_number)`
- PK (entity, year); the same CHECKs as `invoice_sequences`.
- Number format `{entity}-KO-{nnn}/{yy}` (S1).
- The migration seeds it from imported legacy numbers (`IDSS KO-35/26` → IDSS 2026 = 35).
- The legacy import also writes it (TS plan `creditNoteSequences`) for imports after the migration.

### `payment_reversals` (S4)
- Columns: `id`, `payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT`, `reversed_on`, `reason` (non-empty), `created_at`.
- A payment with a reversal no longer counts. Payments themselves are never updated or deleted.

### `credit_movements` (S3)
- Columns: `id`, `from_invoice_id` NOT NULL, `to_invoice_id` NULL (NULL = refund to the parent), `amount > 0`, `moved_on`, `note` (non-empty), `created_at`.
- Validated in Rust:
  - same family and same entity (CONSTITUTION: entities never mixed);
  - the amount does not exceed the credit available on `from_invoice_id`;
  - the target invoice is ISSUED and still has an open amount ≥ the amount.

### Effective balance of an invoice (single definition, mirrored in TS domain and Rust SQL; tests on both sides)
- `net = total + Σ credit notes linked to it` (credit notes are negative)
- `paid = Σ payments without reversal + Σ credit moved in − Σ credit moved out (transfers and refunds)`
- `open = max(0, net − paid)`, `credit = max(0, paid − net)`
- A credit note's own balance is never "open". A credit note is a document, not a debt.

## Commands (E-6: validate → execute → persist → return; single operator, DL-P002)
- `issue_credit_note(draft)` → returns the number.
  - Validates per line: amount < 0, |amount| ≤ remaining creditable on that original line, Σ ≤ remaining of the invoice. Reason is non-empty.
  - Numbers in the transaction, inserts, and sets `CANCELLED` when net = 0.
  - Audit `CREDIT_NOTE`.
- `reverse_payment(payment_id, reason, reversed_on)`
  - Refused if already reversed, or if the payment's money was already moved away (the credit would go negative).
  - Audit `PAYMENT_REVERSAL`.
- `move_credit(from, to | null, amount, date, note)` → audit `CREDIT_MOVE` / `CREDIT_REFUND`.
- `link_legacy_credit_note(credit_note_id, invoice_id)`
  - Same entity and family; only legacy credit notes; only once.
  - Resolves the „Knjižno odobrenje bez veze“ finding in the same transaction (note: „povezano s …“).
- `list_family_credit(family_id)` → credit per entity with the invoices it sits on.
- Zod schemas for all payloads and results in `src/lib/validation/schemas.ts`.

## Rule Constraints Applied
- **BR-23 / S1** — gap-free numbering in the transaction; a separate series per entity.
- **BR-8 / M-7** — credit amounts are integer fenings. The balance has one definition; TS and SQL are tested against the same cases.
- **BR-30** — every new action is audited. **BR-22** — audit details hold ids, numbers and amounts, never names or free-text notes.
- **E-22 spirit / S4** — nothing is deleted or updated in place: credit notes, reversals and movements are appended records.
- **CONSTITUTION project note** — the two legal entities are never mixed in credit movements.
- **A-10** — every new FK is `ON DELETE RESTRICT`.
- **E-19** — migration 010 rebuilds `invoices`. It ships with a test that migrates a database holding legacy and app invoices, payments and findings, then checks counts, totals and `foreign_key_check`.

## Risks / Deviations
- The table rebuild in 010 is the riskiest step. It is tested on a migrated copy with the real-data end-to-end test (L-S3-08) before commit.
- Balances change meaning: „paid“ is now effective paid. Every screen and the PDF slip (open amount) read it from the one summary query, so nothing computes it separately.
- Credit notes of the old workbook could also be partial. They are linked as they are (S5); their amounts are never recalculated (BR-32).
