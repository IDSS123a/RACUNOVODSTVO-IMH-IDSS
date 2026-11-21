# SPEC — Dashboard and audit-log viewer (F3)

*FEATURE_LIFECYCLE Step 1 · Commander v1.8.1 · Matrix `docs/forensics/MATRICA-HTML-DOKUMENT-vs-TAURI.md` §3.1, §3.15 · CONSTITUTION BR-29, BR-30*

## Purpose
- **BR-29:** the operator has a dashboard with statistics for IMH and IDSS.
- **BR-30:** every change is written to the audit log, and the log is viewable in the app.

The Tauri app writes the log but has no screen for either. The HTML document `IMH-IDSS-Fakturisanje.html` has a „Kontrolni panel“ (`vDash`, `renderMonthStatusChart`). It records changes (`logChange`) but has **no screen to view them**.

## User Stories
- As the **operator**, the app opens on an overview. I see at once how many children are enrolled, what is unpaid, what is partly paid and what was invoiced this month, for IMH, IDSS or both. From there I open any recent invoice.
- As the **Director or the accountant**, I see who changed what and when. Examples: an invoice issued, a payment booked or reversed, a credit note, a family edited, a backup restored. Each entry is named so I can recognise it (an invoice number, a family name).

## Dashboard (document `vDash` → decision)

| # | Document | Decision |
|---|---|---|
| D1 | Card „Aktivni upisi / porodice“: count, IMH · IDSS, number of parents | Counts the **enrolments of the current school year** in an active status (`ACTIVE_STATUSES`: awaiting payment, active, withdrawal notified, suspended), per institution, and the number of distinct families. The document counted family rows, which mixed the two institutions. |
| D2 | Card „Neplaćeni računi“: count, „Ukupan dug“ | Invoices with nothing paid and an amount still open. Shows the count, the open amount, and **of which overdue** (due date before today). |
| D3 | Card „Djelimično plaćeni“: count, paid, rest of the debt | As in the document. |
| D4 | Card „Fakturisano u <mjesec>“: total and count of this month's invoices | Invoices **issued** in the chosen month (default: this month). Amounts are after credit notes, as on the invoice (DL-P013 amendment 1). |
| D5 | „Vizuelni pregled naplate“ (D3.js): paid / partly paid / unpaid for the month | A stacked bar with three segments: Plaćeno (paid on fully and partly paid invoices), Ostatak djelimično plaćenih, Neplaćeno. Each segment shows the amount and the number of invoices. Drawn with plain SVG, because M-12 allows no new dependency; D3 is not needed for one bar. |
| D6 | „Zadnje izdate fakture“ (6): number, institution, date, parent / child, amount, status | The 8 most recently issued invoices; clicking one opens its detail (payments, PDF, credit note). The document's e-mail and print buttons are in the detail and the PDF dialog. |
| D7 | Buttons „Generiši naredni mjesec“, „+ Novi račun“ | They open „Računi“, where both actions live. |
| D8 | Institution badge `S.cur` | Filter **Sve / IMH / IDSS**; every figure follows it. IMH and IDSS are never added together unless „Sve“ is chosen (BR-1). |

**Shared rules for every figure:**
- Cancelled invoices and credit-note documents are excluded; credit notes act through the net of their invoice.
- Overpaid counts as paid.
- One definition of the balance: `invoiceBalance` (M-7), the same as in the register.

## Audit-log viewer (BR-30; not in the document)
- A new screen **„Dnevnik izmjena“**, newest first, paged by 200 („Učitaj još“).
- **Filters:**
  - period from–to (default: the last 30 days);
  - kind of change (Računi i uplate / Porodice i upisi / Postavke i podaci / Sve);
  - free text (number, name, detail).
- **Columns:**
  - Vrijeme (local);
  - Radnja (Bosnian label; an unknown code is shown as it is, never hidden);
  - Objekat: the entity kind plus its **readable name**. An invoice by its number, a payment by its invoice number, a family by its name, a child or enrolment by the child's name. When the record no longer exists: „(obrisano)“ and the raw id.
  - Detalji.
- **Read-only.** The log cannot be edited or deleted from the app; there is no command for it.
- **Privacy:** names come from the encrypted database at display time and are never written into the log (BR-22: `details` holds no personal data).

## Navigation
„Kontrolni panel“ becomes the first menu item and the start page, as in the document. „Dnevnik izmjena“ is added to the menu.

## Acceptance Criteria
- [ ] For a set of invoices covering every state, the dashboard figures equal the register's own sums: open, overdue, partly paid, paid, overpaid, cancelled, credit note, legacy and both institutions. In particular, Σ open on the dashboard = „Otvoreno“ on „Računi“ for the same filter.
- [ ] The three bar segments add up to the month's invoiced amount, to the fening.
- [ ] Enrolment counts per institution match the enrolments in active statuses of the current school year.
- [ ] Every audited action has a Bosnian label, and a test fails when a new action code is added without one.
- [ ] Names in the log are resolved; a deleted record shows „(obrisano)“; filters and paging work on 10.000 entries.
- [ ] The Director opens both screens in the running app and checks them against the invoice register (C-13).

## Out of scope
- A printable dashboard report: the period reports come with F4, the Excel export.
- Editing or deleting log entries: never.
