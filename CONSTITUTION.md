# CONSTITUTION.md — Fakturisanje IMH & IDSS
# Project Constitution (wins over Commander for this project — CONSTITUTION precedence 5)
# Commander v1.6.2 · Mode: FULL · Created: 2026-10-20

---

## 1. Identity

| Item | Value |
|---|---|
| Project name | fakturisanje-imh-idss |
| Repository | github.com/IDSS123a/RACUNOVODSTVO-IMH-IDSS (private; history replaced 2026-10-21 by Director decision) |
| Director | Davor Mulalić (direktor@idss.ba) — non-coder, decides business rules |
| Operator (only user) | Financijsko-administrativni menadžer (name and contact stored in app settings) |
| Deployment | Windows installer (MSI/NSIS) installed **only on the operator's computer**. The Director's computer is used for development and testing only. Data never leaves the operator's computer except as encrypted backups; GitHub holds source code only. |
| Mode | FULL (sprints, DONE_CHECKLIST, handoff notes) |
| UI language | Bosnian (bs-BA). Number format `1.234,56 KM`, dates `DD.MM.YYYY.` |
| Code / commits / technical docs | English |

## 2. Vision

An offline Windows desktop application. The operator uses it to:
- bill tuition and one-time fees for two separate legal entities;
- track payment plans, payments and reminders;
- run the monthly ministry subsidy cycle;
- handle withdrawals and refunds.

All of this happens without a single amount being computed in two different ways (M-7).

**Replaces:** the legacy single-file `IMH-IDSS-Fakturisanje.html` and the Excel calculator `IDSS_IMH_Kalkulator_Skolarine_2026-2027.xlsx`. Their defects are documented in `docs/forensics/FORENZICKA-ANALIZA-Fakturisanje.md`.

## 3. Authoritative sources (in this order)

1. **Director's confirmations D1–D16** in `docs/business-rules/ANALIZA-POSLOVNIH-PRAVILA-porodice-3plus.md` §0.
2. IMH Pravilnik o formiranju cijena + Cjenovnik 2026/27. **Exception:** the "3.+ child exempt" paragraph of art. 4 is overridden by D2.
3. IDSS Pravilnik o formiranju cijena + Cjenovnik 2026/27.
4. Program sufinansiranja KS (Sl. novine KS 16/26).
5. Zakon o predškolskom odgoju i obrazovanju KS (26/08, 21/09, 33/21, 31/22).
6. Official letterheads (memorandumi) for institution master data.

**Explicitly ignored:** the deleted "Pravilnik o primjeni Programa (porodice 3+)" (D8). Prilog 3, the Vodič and `index.html` of repo `porodice-3plus` are informative only.

## 4. Business rules (binding — never change without the Director)

### 4.1 Legal entities and programs
| Code | Legal entity | Programs |
|---|---|---|
| `IMH` | Privatna predškolska ustanova "International Montessori House" Sarajevo | `TODDLERS`, `PRESCHOOLERS`, `IDSS_PRESCHOOLERS` |
| `IDSS` | Privatna ustanova "INTERNATIONALE DEUTSCHE SCHULE SARAJEVO" – Međunarodna Njemačka Škola Sarajevo | `PRIMARY_1_4`, `PRIMARY_5_9` (+ services: extended stay, breakfast, summer school) |

- **BR-1** The program determines the legal entity. The user never chooses the legal entity of an invoice line by hand.
- **BR-2** Institution master data (name, address, ID, registration no., account, IBAN, SWIFT, logo) comes from the letterheads and is editable only in Settings.
  - IDSS registration number: **MBSU 65-05-0013-16** (D14).

### 4.2 Pricing
- **BR-3** Prices are versioned per school year in a price-list table. The app never hard-codes amounts (M-7). Seed data: price lists 2025/26 and 2026/27 from the documents.
- **BR-4** IMH: tuition is monthly, 12 instalments (Sep–Aug). Each child pays either the "first child" or the "subsequent child" amount from the price list.
  - The subsequent-child discount is −20%, rounded, as listed.
  - **No child is ever free** (D2).
- **BR-5** IDSS: tuition is annual for 01.09.–30.06.
  - Discounts apply to tuition only: 2nd child −10%; 3rd and every further child −15% (D10).
  - The rounded amounts come from the price list.
  - Extended stay has no discount.
- **BR-6** The sibling discount counts only children of the **same legal entity** (D3). It always goes to the **younger** child: the oldest pays full, the order is by date of birth (D11).
  - The discount ends automatically when a sibling leaves; the remaining child returns to the full amount.
- **BR-7** Any other reduction (scholarship, special discount, different amount) requires a **board decision record**:
  - fields: body (UO IMH / ŠO IDSS), number, date, child, item, amount or %, validity period;
  - not retroactive; valid for at most one school year.
- **BR-8** Money is integer fenings. Rounding happens once, per invoice line (half away from zero). Totals are sums of rounded lines. The screen, the PDF, exports and reports all use the same function.

### 4.2a Invoices (Director, 2026-10-21)
- **BR-23** Invoice numbers: `IDSS-001/26` (school) and `IMH-001/26` (kindergarten): entity prefix, a three-digit sequence, `/`, and the last two digits of the year.
- **BR-24** The invoice is addressed to the family's **"kupac na računu"** (one guardian). A payment may come from **any family member**; it is always booked against the invoice.
- **BR-26** Monthly billing is a **bulk** action for the next month, for **both IMH and IDSS**. The operator reviews every proposed invoice and **approves**; only then are the invoices created (Director, 2026-10-21).
- **BR-27** **One invoice per child** (not per family), per legal entity and month.
- **BR-28** Approved invoices are sent as PDFs to the mailbox **info-mejtas@montessorihouse.ba**, from which they are forwarded to each parent individually. Delivery: an Outlook draft with the PDFs attached, sent by the operator (DL-P006).
- **BR-29** The operator has a **dashboard** with statistics for IMH and IDSS, and can **print** invoices and reports.
- **BR-30** **Every change** is written to the audit log, and the log is viewable in the app.
- **BR-31** The operator can **export all invoices issued in a chosen period** (filterable by entity) as one **.zip** file of PDFs, saved wherever the operator chooses (Director, 2026-10-21).
- **BR-25** A family has at most one mother and one father; further persons are recorded as "Staratelj". The guardian IBAN is optional and is used only for ministry-subsidy refunds.

### 4.3 One-time fees
- **BR-9** IMH: enrolment fee, deposit and materials participation are due before the child starts. Status `AWAITING_ENROLMENT_PAYMENT` until accounting confirms receipt.
  - Direct transfer IMH Preschoolers → IDSS Preschoolers: no enrolment fee, and the deposit carries over.
  - Deposit: refunded within 3 months if all obligations up to 31.08. are settled; kept on early termination.
- **BR-10** IDSS: enrolment fee 1.000/1.500, paid within 7 days of meeting the enrolment conditions.
  - Reduced to **500/1.000** if the child attended IMH IDSS Preschoolers in the year before school (cross-entity lookup).
  - Deposit 1.500 is optional: only with instalment plans, on the school's decision.

### 4.4 Payment plans
- **BR-11** IDSS: per child and school year, an individual plan.
  - Options: pay in full (no advance discount unless a board decision exists), or 1–12 instalments; each instalment is due on the 5th of its month.
  - Extended stay: in full by 31.07. for the next year, or 10 monthly instalments with the director's approval.
  - Breakfast: 60 KM/month, opt-in, up to 10 instalments.
  - The latest due date of a plan's last instalment and the months in which breakfast is billed are **decided by the board (UO IMH / ŠO IDSS)** per school year. They are entered in Settings with the decision reference and are never assumed by the app (Director, 2026-10-21).
  - Summer school: price set by ŠO per year.
- **BR-12** Mid-year start:
  - IDSS charges the remaining months to June, with a monthly basis = annual / 10 and the start month counted in full (assumption confirmed by example 9.700/10 × 6);
  - IMH charges the remaining monthly instalments to 31.08.

### 4.5 Dunning and withdrawal
- **BR-13** Reminders 1–3 with a payment deadline. **No default interest** (D6). After the 3rd reminder: suspension status (1 month), then possible termination.
- **BR-14** IMH withdrawal: written notice 2 months ahead, otherwise one extra month is billed. The monthly fee is always full.
- **BR-15** IDSS withdrawal: written notice 2 months ahead, only at the end of semester 1 or of the school year.
  - Refund of **3 monthly instalments** (annual tuition / 10 × 3) in two cases:
    - the full year was paid by 31.12. and the child leaves for semester 1;
    - the next year was paid in full by 10.05. and the contract ends before the year starts.
  - Instalment payers: the paid instalments and the deposit (minus real costs) are kept; the parent pays through 31.12. or 30.06.
  - No written notice by 31.12. for the next year: everything is kept.
  - Assumption to confirm: for a discounted child the refund basis is the discounted tuition.

### 4.6 Ministry subsidy (IMH only)
- **BR-16** The parent always pays the full invoice. The subsidy never reduces it (D1, D5).
- **BR-17** Monthly cycle:
  1. at the start of month M, IMH issues **one invoice to the ministry** with a list of parents/children for month M−1;
  2. the ministry pays IMH;
  3. IMH refunds each parent's subsidy to the parent's bank account.

  Every step is recorded: invoice, receipt per child, refund per parent, shortfall.
- **BR-18** The app **proposes** the subsidy amount per child from the Program, showing alternatives when rules overlap. The operator **confirms** each amount before the ministry invoice is issued (D12).
  - Program amounts: 235 / 120 KM; 300 / 150 KM; "besplatno"; 80%. August is −50%.
  - Eligibility: EMIS enrolment; BiH citizen with KS residence; parents pay on time.
- **BR-19** The only external payer is the Ministry for Education KS (D13).
- **BR-20** Price-increase cap vs. the previous year (≤3% above 600 KM) is checked and warned. For 2026/27 a written ministry approval exists (D16); its number and date are recorded with the price list.

### 4.7 Data protection (Zakon čl. 53g–53h)
- **BR-21** Child personal data in the electronic record is kept permanently; other records for 5 years.
- **BR-22** The database is encrypted at rest. Backups are encrypted.
  - No personal data in logs, commit messages, filenames or code.
  - Email recipients are taken from the family record, never by name matching.

## 5. Non-goals (until the Director decides otherwise)
- No multi-user access, roles or cloud sync.
- No default interest.
- No second external payer.
- No half-day (poludnevni) programme.
- No direct e-banking or EMIS integration. EMIS data is entered by hand.

## 6. Quality bar
- Every amount on screen, in the PDF, in exports and in reports comes from one domain function and is covered by tests.
- Mandatory: tests for the rounding edge cases (12,5 %, 7,5 %, 0,005), sibling order, withdrawal, mid-year start and the subsidy cycle.
- Round-trip tests for every persisted entity (E-14).
- Accessible, keyboard-friendly UI; light and dark themes from design tokens; no hard-coded colours (E-11).

---

*Commander v1.6.2 — IDSS123a Organisation — Davor Mulalić*
