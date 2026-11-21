# SPEC — Manual invoice „Novi račun“ (F2)

*FEATURE_LIFECYCLE Step 1 · Commander v1.8.1 · Matrix `docs/forensics/MATRICA-HTML-DOKUMENT-vs-TAURI.md` §3.3, F2*

## Purpose
The institutions sometimes invoice a service that no automatic flow covers. Examples are summer school, an excursion, an extra programme, or a lost item. The HTML document `IMH-IDSS-Fakturisanje.html` has a „Novi račun“ screen for this (`vNew`, `saveNewInvoice`); the Tauri app has none. F2 adds it.

## User Stories
- As the **operator**, I issue an invoice for one child for a service outside the price list, with the description, unit, quantity and unit price I enter. The invoice gets the next number of its institution, I see the PDF at once, and nothing is ever recalculated afterwards.
- As the **accountant**, every manual invoice records its **basis** (decision, contract or notice), so I can trace why it was issued.

## What is taken over from the document (source → decision)

| # | Document (`vNew`, `saveNewInvoice`) | Decision |
|---|---|---|
| M1 | Institution, parent, child, address, billing month, issue date, due date | Taken over. The buyer is the family's „kupac na računu“ (BR-24), and the address is the family address; both are shown, not typed. The child must have an enrolment in the chosen institution in the school year of the month (any status except withdrawn); it gives the program, so IMH and IDSS are never mixed (BR-1). |
| M2 | Number preview `IMH 005/26` | The number is assigned by the backend when the invoice is created (BR-23). The screen says „broj se dodjeljuje pri kreiranju“; a preview could be wrong when two windows issue at once. |
| M3 | Item rows: Naziv, JM, Količina, Cijena, Rabat %, Ukupno; „+ Dodaj stavku“ | Naziv, JM (`kom` / `srv`), Količina (whole number 1–999), Cijena (KM, fenings exact), Ukupno = Količina × Cijena. **Rabat % is not taken over**: under BR-7 any reduction needs a board-decision record, and the decision register does not exist yet (`actions.ts`: „decision register arrives with Sprint 04“). |
| M4 | Totals: Prodajna vrijednost, Odobreni rabat, UKUPNO ZA UPLATU | Taken over; rabat is always 0,00 on a manual invoice. |
| M5 | Validations: required fields; due date not before the issue date; quantity > 0; price ≥ 0; total > 0; „Unesite barem jednu ispravnu stavku“ | Taken over word for word where possible, checked in TypeScript and again in Rust. |
| M6 | Due date default `dueFor(month, date)` | Taken over: `dueDateForMonth` (F1, C11). |
| M7 | Buttons: Samo sačuvaj / Print / PDF | „Kreiraj račun“, after which the PDF dialog opens (print and save are there, as for every invoice). |
| M8 | „Brzi odabir iz zvaničnog cjenovnika 2026/2027“ (`CATALOG_2026_2027`) | **Not taken over as a manual line.** All 33 catalog rows are price-list items that Tauri already bills automatically and by rule: tuition, extended stay and breakfast through the monthly bulk with review and approval (BR-26); enrolment fee, materials and deposit through „Račun za upis“, with the continuing-child and transfer rules (BR-9, BR-10). A manual copy would bypass those rules and could bill twice. The screen points the operator to the right flow instead. |
| M9 | Deposit 20 % banner (`checkDepositDiscountRule`) | Already exact in Tauri: the SUBSEQUENT-tier deposit amounts of the price list are applied by the enrolment-fee flow. Nothing to add. |
| M10 | „+ Nova porodica“, „+ Dodaj dijete“ inside the form | Not taken over: families and children are created in „Porodice“, where all their validations live (one buyer, residency, date of birth). |
| M11 | — | **New, required by the accountant's traceability (BR-30):** a „Osnov“ field (for example „Odluka UO br. 12/26“, „Ugovor o ljetnoj školi“). It is mandatory, stored with the invoice, written to the audit log and shown in the invoice detail. |

## Data
- Invoice `kind = 'OTHER'`, `source = 'APP'`, period = the first to the last day of the month, `reason` = the basis.
- Lines `item_code = 'OTHER'`, `list_amount = amount = quantity × unit price`, no board decision.
- Migration 013 adds `invoice_lines.quantity` (default 1) and `invoice_lines.unit` (`kom` / `srv`, null for older lines). Earlier lines keep quantity 1 and their derived unit, so their PDFs do not change.
- The PDF prints Cijena and S rabatom per unit and Iznos bez PDV per line, as the document does (`qty × price`).

## Rules enforced in Rust (defence in depth)
- A manual invoice has only `OTHER` lines, and no other kind may have one.
- `amount = list_amount`, no board decision, quantity 1–999, `amount` divisible by quantity, total > 0.
- The basis is not empty.
- The existing rules still apply: one child, one institution, total = Σ lines.

## Interaction with existing flows
- The monthly bulk skips a child who is „already invoiced this month“. A manual invoice must **not** count, or summer school would stop the August tuition. Only invoices of the app's own `OTHER` kind are excluded; imported invoices (also `OTHER`, but `LEGACY`) still count.
- Credit notes work on manual invoices unchanged (whole or partial, S2).

## Acceptance Criteria
- [ ] A manual invoice for an IMH child and one for an IDSS child each get the next number of their series, and each PDF shows the lines with JM, quantity, unit price and line total. The PDF recap adds up to the fening.
- [ ] Every validation in M5 rejects in the form, and Rust rejects the same draft when it is sent past the form.
- [ ] After a manual invoice for August, the August monthly bulk still proposes that child's tuition.
- [ ] Older invoices render exactly as before (quantity 1, same JM).
- [ ] Migration 013 passes the rehearsal test on a database at version 12 (E-19).
- [ ] The Director creates a manual invoice in the running app and checks its PDF (C-13).

## Out of scope
- Discounts and scholarships: these come with the board-decision register (BR-7).
- Free-text price-list lines (M8).
- Invoices without a child: the constitution bills per child (BR-27).
