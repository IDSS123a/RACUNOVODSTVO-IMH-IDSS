# PLAN — Child prepayment (specs/family-advance/SPEC.md)

*FEATURE_LIFECYCLE Step 2 · waits for the Director's approval · no new dependencies (M-12) · one balance definition (M-7)*

## Data model — migration 016 (append-only: nothing deleted or updated in place)
- **`payments`** gets `payer_relation TEXT NOT NULL DEFAULT ''`. An empty value is shown as „nije zabilježeno“. The child comes from the invoice: every invoice line has `child_id NOT NULL`, one invoice per child.
- **`prepayments`** holds a payment without an invoice:
  - columns: `id`, `family_id`, `entity` ∈ {IMH, IDSS}, `child_id NOT NULL`, `paid_on`, `amount > 0`, `payer_name`, `payer_relation`, `reference`, `note`, `created_at`;
  - a trigger refuses a `child_id` that does not belong to `family_id`.
- **`prepayment_reversals`** holds the storno of a prepayment: `prepayment_id UNIQUE`, `reversed_on`, `reason NOT NULL`, `created_at`.
- **`prepayment_uses`** holds an application to an invoice, or a refund when `invoice_id` is NULL:
  - columns: `id`, `prepayment_id`, `invoice_id NULL`, `amount > 0`, `used_on`, `note`, `created_at`;
  - **`prepayment_use_reversals`** holds the storno of a use, with a reason.
- **Excess on an invoice (Q4)** is not copied anywhere. It stays the computed `paid − net` of that invoice.
  - The child's prepayment counts it as a source.
  - Spending it reuses the existing `credit_movements`, from the invoice to another invoice or to a refund.
  - Existing data (IMH-897/26) therefore needs no data migration: it becomes the child's prepayment by definition.

## One definition (credit_notes.rs, mirrored in credit-notes.ts)
- **Invoice paid:**

  ```
  PAID_SQL = payments − reversed payments
           + credit moved in − credit moved out
           + prepayment uses to the invoice (not reversed)
  ```

- **Invoice applied prepayment** (the PDF line, Q3) = credit moved in + prepayment uses to the invoice.
- **Child prepayment available** (per family, entity and child) is the sum of:
  - Σ prepayments (not reversed) − Σ their uses (not reversed);
  - Σ max(0, paid − net) over the child's issued invoices.
- **Child saldo** = Σ max(0, net − paid) over the child's invoices − child prepayment available. Negative means u pretplati.
- **Invoice status:**
  - OVERPAID is no longer shown. An invoice with excess is „Plaćen“ with „višak X KM je pretplata djeteta“.
  - The invoice saldo shown is max(0, net − paid).

## Backend commands (`prepayments.rs`, registered in lib.rs; every one audited with ids, amounts and the relation only — BR-22)
| Command | What it does |
|---|---|
| `record_prepayment` | validates the child is in the family, the amount (≤ MAX_AMOUNT), the date and the payer name (`check_name`) |
| `child_prepayment(family, entity, child)` | returns the available amount and its sources, oldest first |
| `apply_prepayment(child, entity, invoice, amount, date, note, sibling)` | spends sources oldest first: `prepayment_uses` for prepayments, `credit_movements` for invoice excess |
| `refund_prepayment` | records a refund, at most the available amount |
| `reverse_prepayment` | reverses a prepayment; refused while it has uses that are not reversed |
| `reverse_prepayment_use` | reverses one use, with a reason |
| `record_payment` | takes `payer_relation` as well |

`apply_prepayment` refuses:
- another family or another entity;
- a credit note or a cancelled invoice;
- more than is available, or more than is open on the invoice;
- an invoice of another child without `sibling: true` and a note.

## Frontend
- **`credit-notes.ts`:** `childSaldo`, `familySaldo` by child, `appliedPrepayment`. `BALANCE_LABEL` shows an invoice with excess as „Plaćen“.
- **Payment form** (InvoiceDetailDialog): payer with a choice of the family's guardians, and „Odnos prema djetetu“ (TemplateText with the relation templates and free entry).
- **`PrepaymentDialog`** (new) records a payment without an invoice:
  - the child is chosen, and filled in automatically when there is only one;
  - it shows the DL-P033 warnings, plus „dijete ima neplaćen račun“ with the button „Evidentiraj na taj račun“.
- **`ApplyPrepaymentPanel`** (new):
  - in the invoice detail, and offered after issuing in NewInvoiceDialog, OtherFlow and BillingFlow step D;
  - one click to apply; brother or sister only with a note.
- **`FamilyCreditCard` → `FamilySaldoCard`:**
  - per entity, then per child: charged, paid, saldo, the sources, refund and storno;
  - the family total at the bottom.
- **PDF (`pdf.ts`):**
  - the line „Umanjeno za primljenu pretplatu“;
  - `amountDue` minus the applied prepayment, which also drives the slip and the QR;
  - when it is 0: no slip, and „Plaćeno iz pretplate — ne uplaćujte“;
  - still one page.
- **`renderPaymentReceiptPdf`** (Q5) produces the „Potvrda o uplati“ on the letterhead (`letterhead.ts`), A4, one page, with no slip.
- **Reports:** a new XLSX sheet „Pretplate“; step E keeps „U pretplati“, now computed from child prepayments.

## Tests
- **cargo:** every refusal in SPEC §5; FIFO across both source kinds; reversal rules; the fening identity received = applied + refunded + remaining (also as a random test); migration 016 on a database that already has excess on an invoice.
- **Vitest:** the saldo functions; the PDF line, the amount due, the slip and QR amounts; the paid-from-prepayment text; still one page with dense lines; the receipt PDF; the warnings; the relation templates.
- **Everything:** tsc, eslint, build, and the Director's check (C-13).

## Order of work (each step green before the next)
1. Migration 016, the backend and the backend tests.
2. The one balance definition in TS and its tests; the display without OVERPAID.
3. Payer relation on payments; PrepaymentDialog.
4. Apply, refund and storno panels; the offer after issuing.
5. PDF line and slip; the payment receipt PDF.
6. Reports; DL-P035 (and amendments to S3 and DL-P026); lessons; the Director's check.

## Risks
- **`PAID_SQL` is used by every balance.** A mistake there shows everywhere. Mitigation: the existing storno and credit tests must all stay green, and the new identity test runs over random sequences.
- **The PDF amount due changes when a prepayment is applied after the invoice was sent.** The parent may then hold an older PDF with a higher amount. Mitigation: the application is offered right after issuing (Q2), before the PDF is sent; a later application is audited, and the new PDF can be sent again.
