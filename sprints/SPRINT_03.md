# SPRINT 03 — Invoices, numbering, PDF, payments

**Status:** IN PROGRESS · **Mode:** FULL · **Commander:** v1.6.2
**Depends on:** Sprint 01 (pricing engine, price lists), Sprint 02 (families, enrolments)

---

## Goal

The operator issues correct invoices from the enrolment data, with one click per month (IMH) or per payment plan (IDSS). Every invoice:
- has a gap-free number per legal entity (BR-23);
- is addressed to the family's "kupac na računu" (BR-24);
- shows amounts produced only by the pricing engine (DL-P003);
- prints as a clean A4 PDF with the official letterhead data.

Payments from any family member are booked against invoices, and the open balance is always visible.

## IN scope
1. **Domain (pure TS, tested):**
   - **Numbering:** `IMH-001/26`, `IDSS-001/26`. The next number is computed per entity and year, inside the same database transaction that saves the invoice. Numbers are never reused.
   - **IMH monthly invoices:**
     - one invoice per family and month, with one line per child;
     - tuition by sibling tier;
     - one-time fees (enrolment fee, materials, deposit) as separate lines on the enrolment invoice;
     - due date: the 5th of the month.
   - **IDSS payment plans:**
     - per child and school year: pay in full, or N instalments (1–12);
     - instalment amounts are rounded once, and the last instalment absorbs the rounding difference (so the sum equals the annual amount);
     - mid-year start: pro-rata (BR-12);
     - extended stay and breakfast as optional plan items.
   - **Board decisions** (BR-7) applied to a line when a valid decision exists for the child, item and date.
   - **Invoice totals:** sum of rounded lines; no tax lines (the PDV note text is configurable, see Open questions).
   - **Payment allocation:**
     - a payment (date, amount, payer name, reference) is booked to one invoice;
     - status `OPEN / PARTIALLY_PAID / PAID / OVERPAID`; overpayment is kept as credit and never lost.
2. **Migration 003:** `invoices`, `invoice_lines`, `invoice_sequences`, `payment_plans`, `payment_plan_items`, `payments` (amounts in fenings, CHECK constraints, audit).
3. **Tauri commands + repository**, with round-trip tests (E-14). The invoice number is assigned in Rust inside the transaction, so two windows can never get the same number.
4. **UI:**
   - invoices list (filters: entity, month, status; totals);
   - "Izdaj račune za mjesec" (IMH batch preview → confirm);
   - IDSS payment-plan editor;
   - invoice detail with PDF preview, print and save;
   - record payment.
5. **PDF:** vector (not a screenshot).
   - Content: letterhead data from Settings, official logo, invoice number and dates, buyer, child, lines, total, amount in words, bank details, "Fakturisao/la".

## OUT of scope (Sprint 04)
- Reminders (3, no interest), suspension.
- Ministry invoice and refunds to parents.
- Withdrawal refund rules (IDSS 3 instalments, IMH deposit).
- Cancellation (storno) / credit notes: their numbering is an open question.

## Open questions (asked one at a time, C-6)
1. Does the sequence restart at 001 every calendar year (by invoice date)?
   📌 ASSUMED until answered: yes, by the year of the invoice date. Easily reversible before the first real invoice.
2. The PDV / tax-exemption note printed on invoices, per institution. The text is a legal statement and is not invented (M-4). It is entered in Settings by the operator; there is no default text.
3. Storno / credit-note numbering (needed in Sprint 04).

## Acceptance criteria
- [ ] Numbers are gap-free and unique per entity and year, also under rapid repeated issuing (Rust test).
- [ ] An IMH family with two children → one invoice: 710 + 570 (or the program's amounts), due on the 5th.
- [ ] IDSS 9.700 KM in 12 instalments → 11 × 808,33 + 1 × 808,37 = 9.700,00 (sum exact).
- [ ] An IDSS January start in 6 instalments → 5.820,00 in total.
- [ ] Payment 500 on a 710 invoice → PARTIALLY_PAID, open 210. A further payment of 300 → OVERPAID, credit 90.
- [ ] The PDF opens, shows the correct entity data and amounts identical to the screen.
- [ ] Director's walkthrough approved.
