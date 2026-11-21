# PLAN — Accounting-complete invoice PDF (F1)

## Architecture
- **Domain (pure, tested)**
  - `billing/amount-in-words.ts`: switched to the document's wording (C8). The million / billion range stays (Tauri bound 999.999.999).
  - `invoices/recap.ts` (new): line rows (JM, quantity, price, with discount, discount %, PDV) and the recapitulation, in fenings, from `listAmount` / `amount` (C5, C7). One function feeds the PDF; the screen can use it later (M-7).
  - `invoices/code39.ts` (new): a full Code 39 encoder (`0–9 A–Z - . space $ / + %`, start and stop `*`) that returns bar widths (C2).
  - `invoices/domain.ts`: `dueDateForMonth` returns issue + 5 days after the 5th (C11).
- **Presentation:** `invoices/pdf.ts` re-laid out to the reference.
  - The slip box takes at most the bottom third (≈ 270 pt of 842).
  - The body flows above it, with the existing page-break mechanism.
- **Data:** institutions-seed gives IMH its default PDV note. Migration 012 sets the same text for an existing IMH row whose note is still empty; it never overwrites a note an operator entered.

## Constants (`src/constants`)
- `ISSUE_PLACE = 'Sarajevo'`, `PAYMENT_METHOD = 'Virman / Nalog za plaćanje'`, `DUE_DAYS_AFTER_ISSUE = 5`. Source: the document's template and `dueFor`.

## Rule Constraints Applied
- **BR-8 / M-7:** every amount on the PDF comes from `recap.ts` in integer fenings.
- **BR-24:** one buyer on the invoice.
- **DL-P008:** slip purpose, open amount, QR label and format unchanged; only its position moves (Director 2026-11-21).
- **DL-P011:** credit notes have no slip and print the original's number; the reduction is shown on the original.
- **M-4:** every printed text is quoted from the document or a recorded decision. Nothing is invented; the IDSS PDV text stays open.
- **M-12:** no new dependency. The barcode and the layout are drawn with `pdf-lib` primitives.

## Risks
- **Amount-in-words change:** the existing tests encode today's wording and are updated to the document's. A cross-check against the document's own algorithm guards the change.
- **Layout:** checked by rendering and viewing the PDF; structure-only tests are not enough (L-S3-03).
