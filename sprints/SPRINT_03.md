# SPRINT 03 — Invoices, numbering, PDF, payments

**Status:** IN PROGRESS · **Mode:** FULL · **Commander:** v1.6.2
**Depends on:** Sprint 01 (pricing engine, price lists), Sprint 02 (families, enrolments)

---

## Scope change (Director, 2026-10-21)
- Invoices are issued **one per child** (BR-27), not one per family.
- Bulk monthly billing covers **IMH and IDSS** (IDSS from the payment plans), with review and approval (BR-26).
- Official logos are bundled (BR-2).

Dashboard, reports and audit-log viewer → **Sprint 04** (BR-29, BR-30). Email dispatch (BR-28) and .zip export (BR-31) were pulled into Sprint 03 after the walkthrough.

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
     - one invoice per child and month (BR-27); sibling tier still computed across the family;
     - tuition by sibling tier;
     - one-time fees (enrolment fee, materials, deposit) as separate lines on the enrolment invoice;
     - due date: the 5th of the month.
   - **IDSS payment plans:**
     - per child and school year: pay in full, or N instalments (1–12);
     - instalment amounts are rounded once, and the last instalment absorbs the rounding difference (so the sum equals the annual amount);
     - mid-year start: pro-rata (BR-12);
     - extended stay as an optional plan item (up to 10 instalments, pro-rata on a mid-year start);
     - the latest due date of the last instalment is a **board decision** (Director, 2026-10-21): entered per school year in Settings with the decision reference; enforced only once entered;
     - monthly IDSS invoices bill every plan instalment due in the month, once (the plan instalment is marked with the invoice inside the issuing transaction);
     - an IDSS child without a tuition plan is listed in the preview as a problem.
     - Breakfast (opt-in per child): billed as a line on the child's monthly IDSS invoice in the months the board decided (entered in Settings); until entered, the preview lists the child as a problem.
   - **Board decisions** (BR-7) applied to a line when a valid decision exists for the child, item and date.
   - **Invoice totals:** sum of rounded lines; no tax lines (the PDV note text is configurable, see Open questions).
   - **Payment allocation:**
     - a payment (date, amount, payer name, reference) is booked to one invoice;
     - status `OPEN / PARTIALLY_PAID / PAID / OVERPAID`; overpayment is kept as credit and never lost.
2. **Migrations 003–004:** `invoices`, `invoice_lines`, `invoice_sequences`, `payment_plans`, `payment_plan_items`, `payments` (amounts in fenings, CHECK constraints, audit); 004 adds `invoices.child_id` and a per-child double-billing guard.
3. **Tauri commands + repository**, with round-trip tests (E-14). The invoice number is assigned in Rust inside the transaction, so two windows can never get the same number.
4. **UI:**
   - invoices list (filters: entity, month, status; totals);
   - "Izdaj račune za mjesec" (IMH batch preview → confirm);
   - IDSS payment-plan editor;
   - invoice detail with PDF preview, print and save;
   - record payment.
5. **PDF:** vector (not a screenshot).
   - Content: letterhead data from Settings, official logo, invoice number and dates, buyer, child, lines, total, amount in words, bank details, "Fakturisao/la".
   - Done (DL-P007): pdf-lib + pre-subset Noto Sans; preview in the app (WebView2 PDF viewer) with „Štampaj“ and „Sačuvaj PDF“; saving is audited.

## Walkthrough remarks (Director, 2026-10-21) — pulled into Sprint 03
1. ✅ Monthly invoices: no bulk **.zip export** (BR-31) → „Izvoz i slanje“ on Računi; offered right after approving the monthly invoices.
2. ✅ Monthly invoices: no sending to info-mejtas@montessorihouse.ba → Outlook draft with **each PDF and one .zip** attached (DL-P006); large periods split into several drafts.
3. ✅ The invoice file name carries the child: `IMH-001-26_Emina_Begic.pdf` (ASCII in file names; the PDF keeps the exact spelling).
4. ✅ No payment slip on the invoice → pre-filled slip in the bottom half of the last page, amount = open balance (DL-P008).
5. ✅ (provisional) No QR code → provisional EPC-format QR with BAM on the slip, labelled „QR kod za plaćanje“, until a BiH bank confirms its format (DL-P008 addendum).

## OUT of scope (Sprint 04)
- Dashboard with statistics, printed reports, audit-log viewer (BR-29, BR-30).
- Reminders (3, no interest), suspension.
- Ministry invoice and refunds to parents.
- Withdrawal refund rules (IDSS 3 instalments, IMH deposit).
- Cancellation (storno) / credit notes: their numbering is an open question.

## Open questions (asked one at a time, C-6)
1. Does the sequence restart at 001 every calendar year (by invoice date)?
   ✅ Confirmed (Director, 2026-10-21): yes — 001 every calendar year, by the year of the invoice date (IMH-001/27, IDSS-001/27).
2. ✅ The PDV / tax-exemption note: field „Napomena na računu“ per institution in Settings (migration 006), printed on every invoice; no default text (M-4). The institution still has to enter the exact wording.
3. Storno / credit-note numbering (needed in Sprint 04).
4. ✅ Breakfast months and the last-instalment deadline: decided by the board each year → Settings (Director, 2026-10-21).

## Acceptance criteria
- [x] Numbers are gap-free and unique per entity and year, also under rapid repeated issuing (Rust test).
- [x] An IMH family with two children → **two invoices**, one per child: 750 and 570 (by program and tier), due on the 5th.
- [x] IDSS 9.700 KM in 12 instalments → 11 × 808,33 + 1 × 808,37 = 9.700,00 (sum exact).
- [x] An IDSS January start in 6 instalments → 5.820,00 in total.
- [x] Payment 500 on a 710 invoice → PARTIALLY_PAID, open 210. A further payment of 300 → OVERPAID, credit 90.
- [x] The PDF opens, shows the correct entity data and amounts identical to the screen (rendered and checked; Director walkthrough).
- [x] Director's walkthrough approved (2026-10-21): bulk invoices IMH + IDSS, PDF, print, save, .zip export, Outlook draft, file names.

## Legacy import (BR-32) — analysis of the example workbook (structure only, no personal data copied)
- Sheet `DB`: header in row 8, one row per invoice line, data from row 9. Columns: A institution name, B entity (IMH/IDSS), C number, D–E billing period, F invoice date, G due date, H father, I mother, J "dijete: <name>", K item text, M unit, N quantity, O price, Q discount, T line amount, U "plaćeno" (paid flag, no payment date).
- Example file: ~1.570 invoices, ~4.630 lines, invoice dates 01–09/2026; 2–6 line rows per invoice (empty rows with quantity 0).
- Numbering: IMH `NNN/26` and `NNN-B/26` share one sequence (max 896); IDSS `NNN/26` (max 568) plus 3 numbers `/23`; IDSS credit notes `KO-NN/26` with negative amounts.
- Items are free text (tuition by month, materials, enrolment fee, breakfast, extended stay, summer school, scholarship decision) → mapped to item codes by keywords; unknown text kept as „Ostalo“.
- Sheet `Setting`: register of families (father, mother, child, address, entity) — no dates of birth.
- ✅ Scope (Director, 2026-10-21): import the invoices **and** the family register from `Setting`; children come without a date of birth, which the operator adds later (a child without it cannot be billed by the new app until it is entered).
- ✅ Numbering (Director, 2026-10-21): the state after the import at first start on the operator's PC is final; new invoices continue from the **next free number per entity and year** found by the import (e.g. IMH-897/26, IDSS-569/26). Imported numbers are kept as written.
- Open decisions (asked one at a time): meaning of the `-B` series, payment date for "plaćeno".

## Still open before Sprint 03 closes
- ✅ Enrolment-fee invoice („Račun za upis“ on each enrolment): one invoice per child and school year (migration 007), separate lines.
  - IMH: enrolment fee and deposit only for a new child (a child continuing in IMH, including the transfer Preschoolers → IDSS Preschoolers, keeps both); materials every year; deposit by sibling tier. Due before the start.
  - IDSS: enrolment fee, reduced after IDSS Preschoolers; deposit only when ticked and with an instalment plan. Due in 7 days.
  - ✅ Confirmed (Director, 2026-10-21): (a) an IDSS pupil continuing from the previous year pays no new enrolment fee.
  - ✅ Confirmed (Director, 2026-10-21): (b) the deposit of a child continuing in IMH is carried over to the next year.
- ✅ Installer 0.2.0 built (2026-10-21): `INSTALACIJA/Fakturisanje IMH IDSS_0.2.0_x64-setup.exe`, SHA-256 `36ebdb6d…85350e57`; demo-data button absent from the release build.
- ⏳ Install on the operator's PC and run the checklist in the guide §3 (institution data, board rules, Outlook draft, QR scan).
- Test database on the developer PC deleted after the walkthrough (2026-10-21).
