# SPEC — Storno, credit notes and payment correction

*FEATURE_LIFECYCLE Step 1 · Commander v1.8.1 · Sprint 04 scope (SPRINT_03 „OUT of scope“)*
*Decisions S1–S6 by the Director, 2026-11-21, asked one at a time (C-6).*

## Purpose
An issued invoice can never be deleted or changed: its number and amounts are part of the books. Mistakes still
happen — a wrong amount, a child who left, a payment booked on the wrong invoice. Today the application has no way
to correct any of them. The status `CANCELLED` exists in the database, but nothing sets it, and a wrong payment
stays in every balance for good (forensic findings K4, 2026-11-21).

Before go-live the operator must be able to:
- cancel an invoice completely or partly with a **credit note** („knjižno odobrenje“) — a separate, numbered
  document that keeps the original untouched;
- keep every fening that was paid. Money on a cancelled invoice becomes the family's **credit** and never
  disappears (forensic analysis, recommendation 11);
- correct a wrongly booked payment with a **counter-entry**, never by deleting it;
- link the three credit notes imported from the old workbook to the invoices they cancel.

## User Stories
- As the **operator**, I issue a credit note for a whole invoice or for chosen lines or amounts, with a reason, so a wrong invoice is corrected without deleting anything.
- As the **operator**, after a whole monthly invoice is cancelled, I issue a corrected invoice for the same child and month with a new number.
- As the **operator**, I see a family's credit and either move it to another open invoice of the same institution or record a refund to the parent, with a date and a note.
- As the **operator**, I reverse a wrongly booked payment with a reason and book the correct one; both stay visible.
- As the **operator**, in „Za provjeru“ I link an imported credit note to the invoice it cancels, so that invoice's balance is right.
- As the **Director / accountant**, I see every credit note, credit movement and payment reversal, with who, when and why, in the audit log and on the documents.

## Decisions (Director, 2026-11-21)
- **S1 — Numbering.** Credit notes have their own series per institution, restarting at 001 each calendar year by the date of the credit note: `IMH-KO-001/26`, `IDSS-KO-001/26`.
  - IDSS continues after the imported `KO-35/26`, so the next one is `IDSS-KO-036/26`.
  - Numbers are gap-free and never reused (as BR-23).
- **S2 — Scope.** A credit note cancels the **whole invoice or part of it**: chosen lines, or part of a line's amount.
  - A reason is required.
  - The credit notes of one invoice together never exceed its total.
- **S3 — Money already paid.** When the credit notes bring an invoice below what was paid, the difference becomes a **credit of the family**.
  - The operator moves the credit by hand to another open invoice of the same family, or records a refund to the parent with a date and a note.
  - A credit never disappears.
- **S4 — Wrong payment.** A payment is never deleted. It is reversed by a **counter-entry with a reason**.
  - The original stays visible but no longer counts; the correct payment is then booked.
- **S5 — Imported credit notes.** The three legacy credit notes are linked to their original invoice **by hand** from „Za provjeru“, category „Knjižno odobrenje bez veze“.
  - After linking, that invoice's balance includes the credit note.
- **S6 — Re-issuing.** After a monthly invoice is cancelled **in full**, a new invoice for the same child and month may be issued with the next number.
  - The cancelled invoice stays in the register.

## Constitution constraints (not decisions — they follow from CONSTITUTION.md)
- Two legal entities are never mixed: a credit note belongs to the institution of its invoice, and a family's credit moves only to invoices of the **same institution** (§ PROJECT NOTES, BR-1).
- Every change is audited (BR-30); no personal data in logs (BR-22).
- Money is integer fenings, rounded once per line (BR-8); a credit note's lines are negative copies of the original line amounts or a part of them.

## Acceptance Criteria
- [ ] A credit note for a whole invoice brings its open balance to 0. The invoice shows „STORNIRAN“, and its money paid so far becomes family credit.
- [ ] A partial credit note (chosen lines or part of a line) reduces the balance by exactly its amount. Over-crediting is refused.
- [ ] Credit-note numbers follow S1, including `IDSS-KO-036/26` after the import, and are gap-free under rapid repeated issuing.
- [ ] A credit note has a PDF titled „KNJIŽNO ODOBRENJE“ with its number, date, the original invoice number and date, the reason, and negative amounts. It has no payment slip.
- [ ] Family credit is shown per institution. Moving it to an open invoice of the same family and institution, or recording a refund, keeps the total money identical (paid = applied + refunded + remaining credit) to the fening.
- [ ] Moving credit to an invoice of the other institution is impossible.
- [ ] A payment reversal needs a reason. Afterwards the payment no longer counts in any balance but stays visible with its reversal. The audit log records both.
- [ ] After a full credit note on a monthly invoice, the monthly billing offers that child and month again (S6). After a partial one, it does not.
- [ ] The three imported credit notes can be linked from „Za provjeru“. Linking resolves the finding and changes the original invoice's balance.
- [ ] Nothing is ever deleted: invoices, credit notes, payments, reversals and credit movements all stay in the database.

## Explicitly Out of Scope
- Reminders / dunning, suspension (BR-13).
- Withdrawal refund rules (BR-14, BR-15) and the ministry subsidy cycle (BR-16–BR-18). A credit note can be the *means* for them later, but their rules are not part of this feature.
- Automatic allocation of credit (Director chose manual, S3).
- Bank or e-banking export of refunds.

## Open Questions (non-blocking — for the accountant before go-live)
- The exact legal wording on the credit-note PDF (beyond the fields above). It is configurable per institution, like the PDV note (migration 006).
