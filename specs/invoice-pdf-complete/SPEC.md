# SPEC — Accounting-complete invoice PDF (F1)

*FEATURE_LIFECYCLE Step 1 · Commander v1.8.1 · Matrix `docs/forensics/MATRICA-HTML-DOKUMENT-vs-TAURI.md` §2, F1*

## Purpose
Every invoice issued from go-live is a legal accounting document sent to parents and kept by the accountant. Today's PDF is missing fields that the institutions' own document and sample invoice have. The reference is the HTML document `IMH-IDSS-Fakturisanje.html` (19.10.2026) and its sample invoice `Faktura_IMH_004_26.pdf`. The missing fields are:
- the rabat / PDV columns;
- the recapitulation;
- the PDV exemption note;
- place and method of payment;
- the stamp and signature fields;
- the barcode.

The Director (2026-11-21) asked for the complete invoice: the issuing institution's logo, the payment slip in the **bottom third** and the QR code.

## User Stories
- As the **operator**, every invoice I print or send looks like the institution's official invoice and contains everything the accountant needs, so I never re-issue a document because a field is missing.
- As a **parent**, I pay from the slip at the bottom of the invoice or by scanning the QR code, with the correct account, amount and purpose.
- As the **accountant**, the invoice shows the sales value, the discount granted, the value without PDV, PDV 0 % and the PDV exemption basis, and every figure adds up to the fening.

## Content (source → decision)

| # | Element | Source | Decision |
|---|---|---|---|
| C1 | Letterhead: logo of the issuing institution, full name, address, phone, e-mail, web, ID (JIB), registration number, **transaction account and bank** | sample invoice | kept and extended with the transaction account |
| C2 | Title „RAČUN br. …“ / „KNJIŽNO ODOBRENJE br. …“ and a **Code 39 barcode** of the number | sample invoice, `c39` | The barcode encodes the **whole** number, e.g. `IMH-004/26`. The document's own encoder kept only digits, which was a defect. |
| C3 | Box: billing period, issue date, due date, **place of issue: Sarajevo**, **method of payment: Virman / Nalog za plaćanje** | sample invoice | as in the source |
| C4 | Buyer box: buyer („kupac na računu“), child, address | sample invoice, BR-24 | one buyer, as in BR-24. The sample's extra „Majka:“ line is not printed, because the invoice is addressed to one guardian. |
| C5 | Table: R.br., Naziv, JM, Količina, Cijena, S rabatom, Rabat %, PDV %, PDV iznos, Iznos bez PDV | sample invoice | as in the source. Line data: JM `srv` (monthly service) or `kom` (one-time item), quantity 1, cijena = amount by price list, s rabatom = invoiced amount, PDV 0 %. |
| C6 | Note: „PPU nije obveznik PDV-a, u skladu sa članom 24. stav 1. tačka 4. Zakona o PDV.“ + „Dokument je izrađen na računaru, i punovažan je bez potpisa i pečata.“ + „Uplatu izvršiti na TRN: <bank> -> <account>“ | `ui-views.js`, `NOTE` | The PDV sentence is the institution's setting. IMH gets the document's text as its default. The other two sentences are always printed. |
| C7 | Recapitulation: Prodajna vrijednost, Iznos odobrenog rabata, Vrijednost bez PDV, Iznos PDV (0 %), UKUPNO ZA UPLATU | sample invoice | as in the source. A credit note reduction and the paid amount are added below when present (DL-P011). |
| C8 | Amount in words: „šest stotina osamdeset i 00/100 KM“ | `slova` | The **document's wording** replaces today's („šesto osamdeset KM i 00/100“). |
| C9 | Payment slip (Nalog za uplatu) in the **bottom third** of the last page: uplatio je, svrha doznake, primalac, mjesto i datum uplate, potpis nalogodavca, račun primaoca in digit boxes, iznos, rok uplate, IBAN/SWIFT, pečat banke, potpis ovlaštenog lica, QR | sample invoice; Director 2026-11-21 | bottom third. Purpose: number, child, period (DL-P008, IDSS Pravilnik čl. 3). Amount: what is still open (DL-P008). QR label: „QR kod za plaćanje“ (DL-P008 addendum, Director 21.10). |
| C10 | Signatures: Fakturisao/la (operator), M.P., Ovlašteno lice, Komitent | sample invoice | as in the source |
| C11 | Due date: the 5th of the month; when issued after the 5th, **issue date + 5 days** | `dueFor`; sample: issued 14.10 → due 19.10 | replaces today's „due on the issue date“ |

## Acceptance Criteria
- [ ] For 10.000 random invoices: Σ lines = Iznos bez PDV = UKUPNO; Prodajna vrijednost − Iznos odobrenog rabata = Vrijednost bez PDV; PDV = 0. All in integer fenings.
- [ ] The amount in words equals the document's `slova` for 100.000 random amounts below one million, and every amount up to 999.999.999,99 is spelled.
- [ ] The barcode decodes back to the invoice number, checked by a Code 39 decoder in the test.
- [ ] One-line invoice: one A4 page, slip within the bottom third, QR present. A long invoice continues on later pages, and the slip is on the last page.
- [ ] A credit note shows no slip and no QR; its recapitulation is negative.
- [ ] A cancelled invoice shows „STORNIRAN“ and no slip.
- [ ] IMH invoices print the PDV note by default. IDSS prints its setting (empty until the accountant confirms the text — Open Questions).
- [ ] A rendered sample is checked visually against `Faktura_IMH_004_26.pdf`, and then by the Director in the running app (C-13).

## Explicitly Out of Scope
- A bank-confirmed QR format (DL-P008 stays provisional).
- Sending by e-mail (BR-28 unchanged).

## Open Questions (non-blocking)
- The PDV exemption sentence for **IDSS**. The document prints the PPU sentence on IDSS invoices too, but IDSS is a P.U., not a PPU. The accountant confirms the exact text; until then the IDSS setting stays as entered.
