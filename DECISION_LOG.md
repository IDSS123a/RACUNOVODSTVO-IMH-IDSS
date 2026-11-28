# DECISION_LOG.md — Fakturisanje IMH & IDSS
# Project-level decisions (Commander DECISION_LOG applies unless overridden here)

---

## DL-P001 — Stack: Tauri 2 + React + TypeScript + Vite + encrypted SQLite (M-16 deviation)

**Date:** 2026-10-20 · **Approved by:** Director (accepted proposal 4 of the bootstrap)

**Decision:** an offline Windows desktop application.
- Presentation: React + TypeScript (strict) + Vite, with Tailwind CSS + shadcn/ui (DL-011).
- Shell: Tauri 2.
- Persistence: a local SQLite database encrypted at rest.
- Not used: Next.js, Supabase or Vercel.

**Rationale:**
- There is one operator, so there is no shared-data requirement.
- The data is sensitive (children, parents, bank accounts; Zakon čl. 53h), and keeping it local avoids a cloud data processor.
- The Director requires a desktop application that works without internet.
- The legacy app was a browser-bundled HTML file whose source is not available. A rebuild is needed in any case, so M-16's "keep the working codebase" does not apply.

**Layer translation (A-1):**
- Presentation: `src/features/*/components`.
- Application: `src/features/*/actions.ts` (orchestration, Zod validation).
- Domain: `src/features/*/domain.ts` (pure TypeScript, no Tauri imports, fully unit-tested).
- Infrastructure: `src/features/*/repository.ts`, which calls Tauri commands. The commands are implemented in Rust (`src-tauri/src`) and own all SQL.
- External: SQLite file and file system.

**Alternative rejected:** Next.js + Supabase (EU region). It would give automatic cloud backup and multi-device access, but requires internet and login and places child data with a cloud processor.

**Upgrade path:** if a second user or remote access is ever required, the Domain layer (pure TypeScript) moves unchanged to a Next.js + Supabase app. Only the Infrastructure layer is rewritten.

---

## DL-P002 — No authentication / RBAC layer

**Date:** 2026-10-20

**Decision:** single operator (Director, 2026-10-20), so the app has no login and no roles. Access control is:
- the operator's Windows account;
- the database encryption key bound to that account (DL-P004).

**Consequence:** Commander E-6 steps "authenticate / authorise" collapse to "the encrypted database could be opened". Every write is still recorded in the audit log with a timestamp.

---

## DL-P003 — Money as integer fenings, one rounding point

**Date:** 2026-10-20

**Decision:** all amounts are stored and computed as integer fenings.
- Rounding happens once per invoice line (half away from zero), in `src/features/billing/money.ts`.
- Totals are sums of rounded lines.
- Percentages are stored as basis points (12,5 % = 1250).

**Rationale:** the forensic analysis (docs/forensics) found 1-fening drifts between form, PDF and database, and percentage truncation (12,5 % → 13 %). Both were caused by mixed float rounding in several places (M-7).

---

## DL-P004 — Database encryption at rest  `[DECIDED 2026-10-21 — supersedes the SQLCipher proposal of 2026-10-20]`

**Decision:** in-memory SQLite (`rusqlite`, bundled) with **encrypted snapshots**.
- After every committed write, the whole database is serialised and encrypted with **AES-256-GCM**, using crate `aes-gcm` (pure Rust, RustCrypto). A fresh random nonce is used per write.
- The snapshot is written atomically (temp file + rename). The previous snapshot is kept as `.prev`.
- The 256-bit data key is protected with **Windows DPAPI** (`CryptProtectData`, crate `windows` by Microsoft), so it is bound to the operator's Windows account.
- A one-time **recovery key** (base64) is shown on first run, to be printed and kept by the Director. Restoring a backup on another machine or account uses it.
- Backups are the same encrypted snapshot format (`*.fkbak`).

**🔄 Course correction:** the SQLCipher proposal (`bundled-sqlcipher`) needs OpenSSL and a native Perl build on Windows. Neither exists on the build machine. Pure-Rust AES-GCM avoids the native crypto toolchain completely. Keyring was replaced with direct DPAPI, which has fewer moving parts.

**Why:** Zakon o predškolskom odgoju KS čl. 53h requires cryptographic protection of personal data.

**Trade-off:** each write rewrites the whole file. This is fine for the expected size (a few MB).

**New dependencies (M-12):** `rusqlite`, `aes-gcm`, `rand`, `base64`, `thiserror`, `chrono`, `windows`, `tauri-plugin-dialog`. All are part of the approved "encrypted local database" proposal (bootstrap answer 4). Listed here for the record.

**Verified by tests:**
- the file on disk is not readable SQLite;
- a wrong key or a tampered file fails;
- the DPAPI round trip works, and the raw key is never stored in clear;
- restore with the recovery key works on another key store.

**Amendment 1 (2026-11-21, forensic finding V1, approved by the Director):** the write order is now disk first, then memory.
- `Store::write` encrypts and writes the snapshot of the open transaction BEFORE `COMMIT`.
  - If the disk write fails (file locked by an antivirus, full disk), the transaction is rolled back. The operator's error message is then true: the invoice does not exist and its number is not used.
  - Before this amendment, the commit came first. A failed disk write left the invoice and its number in memory, where they were written to disk by the next successful write.
- The temp file is flushed with `sync_all` before the rename, so a power cut cannot leave an empty database file.
- `Store::restore` writes the restored database first and saves a new key only afterwards. If saving the key fails, the previous database is written back.
  - Before this amendment, the key was saved first, and a failed database write left a key file that no longer opened the database.
- Verified by `a_failed_disk_write_rolls_the_change_back_in_memory` and `a_restore_that_cannot_write_the_database_keeps_the_old_key`. Both tests fail against the previous order and pass with the new one.

---

## DL-P005 — Price lists are data, versioned per school year

**Date:** 2026-10-20

**Decision:** every price (both entities, all items, first/subsequent child, domestic/foreign) is a row in `price_list_items`, keyed by school year.
- The seeds for 2025/26 and 2026/27 are transcribed from the official documents and cite their source.
- No price literal may appear in application code.

---

## DL-P006 — Sending approved invoices: Outlook draft with PDF attachments

**Date:** 2026-10-21 · **Decided by:** Director

**Decision:** the app does not send email itself.
- For approved invoices, the app creates an **Outlook message draft** addressed to `info-mejtas@montessorihouse.ba` with one PDF per invoice attached.
- Azra reviews the draft and presses *Send* herself.
- From that mailbox the invoices are forwarded individually to the parents (outside the app).
- **Attachments (Director, 2026-10-21): both** — one PDF per invoice (for forwarding to each parent) **and** one .zip with all of them. The body lists number, child, buyer and amount. A draft larger than ~20 MB is split into several drafts.

**Why:**
- the app stays offline;
- no mail server, password or token is ever stored;
- the operator keeps the last look before anything leaves the institution.

**Technique (Sprint 04):** an `.eml` file with header `X-Unsent: 1` is generated and opened with the default mail program; classic Outlook opens it as an editable draft.
📌 To verify at installation: which Outlook is on the operator's PC (classic or "new Outlook"). New Outlook may open `.eml` read-only; the fallback is to open the folder with the PDFs next to a prepared draft.

---

## DL-P007 — Invoice PDF: pdf-lib in the frontend, embedded Noto Sans

**Date:** 2026-10-21

**Decision:** invoices are drawn as **vector PDFs** in TypeScript with `pdf-lib` 1.17.1 (MIT) and `@pdf-lib/fontkit` 1.1.1 (MIT).
- Font: **Noto Sans** Regular/Bold (SIL OFL 1.1, license in `src/assets/fonts/OFL.txt`), pre-subset to Latin with fontTools (~24 KB each) and embedded whole, so č ć đ š ž print correctly on every PC. 🔄 pdf-lib's own subsetting dropped glyphs (verified by rendering), hence the pre-subset (see `src/assets/fonts/README.md`).
- Logos come from `src/assets/logos`; letterhead data from the institutions in Settings; "Fakturisao/la" from the operator profile.
- The same bytes are used for preview/print (WebView2 PDF viewer), saving, the Outlook draft (DL-P006) and the .zip export (BR-31).

**Why:** works offline, no native toolchain, unit-testable (the generator runs in Vitest), one code path for every use of the PDF.

**Rejected:** screenshot/HTML-to-image (not vector, M-4 forensic finding); browser print only (no file for email/zip); Rust `printpdf` (more code for text layout, no gain).

**New dependencies (M-12):** `pdf-lib`, `@pdf-lib/fontkit` (pinned exact versions), font files (not a package).

**Addendum (2026-10-21):** `fflate` 0.8.2 (MIT, pinned) builds the .zip for BR-31 and for the Outlook draft (DL-P006). The draft is an `.eml` written to `%TEMP%akturisanje-nacrti` and opened with the default mail program; drafts older than one hour are deleted on the next send because they contain personal data.

---

## DL-P008 — Payment slip on the invoice; no QR code until a BiH bank confirms a format

**Date:** 2026-10-21 · **Trigger:** Director's walkthrough ("nema uplatnice", "nema QR koda")

**Decision:**
- Every invoice PDF has a pre-filled domestic **payment slip** ("Nalog za uplatu / Uplatnica") in the bottom half of the last page: payer, purpose (invoice number, child, period — IDSS Pravilnik čl. 3), payee, payee account, and the **amount still open** (forensics §2.10). Place/date, payer account and reference stay blank for the parent. Cancelled invoices have no slip.
- **No QR code for now.** The old app printed an EPC/SEPA QR (`BCD/002/SCT`), a EUR standard: BAM amounts, a payee name over 70 characters and a non-RF reference make it likely to be rejected by BiH banks (forensics §5.2). No BiH payment-QR standard or bank specification could be confirmed (web search 2026-10-21). Printing an unverified QR could send money wrongly or fail at the bank (M-4).
- **To re-enable:** the bank (Sparkasse Bank BiH) provides the QR format its mBanking accepts, or a test with a real payment confirms one; then the QR is added to the slip and verified with a test payment.

**Addendum (Director, 2026-10-21): provisional QR now.** The slip carries a QR in an **assumed** format until a bank confirms one:
- EPC QR (`BCD` / `002` / UTF-8 / `SCT`), BIC and IBAN of the institution, payee = short name (≤ 70), amount = open balance as `BAM…` (not defined by EPC, which is a EUR standard), free text "Račun <number> <child>" (≤ 140), no structured reference;
- labelled only "QR kod za plaćanje" (Director, 2026-10-21: no "provisional" wording on the parents' invoices);
- generated with `qrcode` 1.5.4 (MIT, pinned) and drawn as vector squares; verified by decoding the rendered PDF (OpenCV);
- replace by the bank's format as soon as it is known.

---

## DL-P009 — Legacy import: calamine reader, TypeScript plan, one-transaction write

**Date:** 2026-10-21 · **Requirement:** BR-32

**Decision:**
- The old workbook is read in Rust with `calamine` 0.37 (MIT, pure Rust, no default features). It returns typed cell values only; **macros in the .xlsm are never executed**.
- The mapping (grouping lines into invoices, families from `Setting` + invoices, item codes, paid flag, next numbers) is a pure TypeScript function with tests; the Rust side writes the prepared plan in **one transaction** and re-checks every invoice total against its lines.
- Imported invoices are stored with `source = 'LEGACY'` and the number **as written, prefixed with the entity** (`IMH 895/26`, `IMH 754-B/26`, `IDSS KO-35/26`), because the number column is unique across both institutions and the old IMH and IDSS sequences overlap. New numbers keep their own form (`IMH-897/26`).
- Migration 008 rebuilds `children`, `invoices` and `invoice_lines` (date of birth optional, negative totals and lines without enrolment only for imported invoices). Migrations now run with foreign keys OFF and must leave `PRAGMA foreign_key_check` empty — SQLite's documented procedure for table rebuilds.
- Re-imports are idempotent: families, children and invoices carry their legacy key / number; only newly paid invoices get a payment.

**Verified (2026-10-21):** the example workbook (1.569 invoices) imports into an in-memory database with 0 foreign-key violations; the sum of imported payments matches the workbook's „plaćeno“ total once lines with negative amounts (scholarships) are netted per invoice; next numbers IMH-897/26 and IDSS-569/26. No personal data from the workbook was written to the repository or logs.

---

## DL-P010 — One running instance: exclusive lock on the data folder

**Date:** 2026-11-21 · **Source:** forensic review 2026-11-21 (finding K3), approved by the Director („Da, kreni“)

**Problem:** the database lives in memory and every write replaces the whole encrypted snapshot (DL-P004). Two running copies of the application each held their own copy and overwrote each other's file: invoices issued in one window disappeared, and both could hand out the same invoice number (numbering is unique only within one process).

**Decision:**
- `Store::open` first takes an exclusive lock on `fakturisanje.lock` in the data folder (Windows share mode 0), before the key or the database is touched. The lock is held for the lifetime of the process.
- A second instance gets `ALREADY_RUNNING`. The startup screen says the application is already open and must be closed, with no retry button. It never reads or writes the database.
- Windows releases the lock when the process ends, also after a crash, so there is never a stale lock to clean up.

**Why not `tauri-plugin-single-instance`:** it would only focus the first window. It would be a new dependency (M-12), and it would not protect against a second process opening the same data folder in another way. The lock guards the data itself and uses only the standard library.

**Verified:** `store::tests::a_second_instance_is_refused_and_writes_nothing` — the second open is refused, the database file is byte-for-byte unchanged, and the lock is released when the first instance ends. Live (`tauri dev` + a second start of the same executable): the second instance shows the message, and its log records the refusal.

---

## DL-P011 — Storno: credit notes, payment reversal and family credit as appended records

**Date:** 2026-11-21 · **Spec:** `specs/storno-credit-notes/` · **Decisions:** S1–S6 by the Director, asked one at a time (C-6)

**Decision:**
- **Credit notes are invoices** with `kind = 'CREDIT_NOTE'`, a negative total, `credits_invoice_id` pointing to the invoice they cancel and a required reason.
  - Migration 010 rebuilds `invoices` with the 008 procedure.
  - Each credit-note line names the original line it credits (`invoice_lines.credits_position`, migration 011), so a line is never credited above its amount.
- **Numbering** is a separate series per institution and year: `IMH-KO-001/26`, `IDSS-KO-036/26` (S1).
  - The series continues after the imported `KO-35/26`, seeded by migration 010 and by the legacy import.
- **Full cancellation sets the original to `CANCELLED`**.
  - The existing per-child monthly guard counts only `ISSUED`, so the month can be billed again (S6) without a new rule.
- **Nothing is deleted or updated in place.** Payment reversals (S4) and credit movements or refunds (S3) are their own tables.
  - The only in-place update is linking an imported credit note to its invoice (S5), which also resolves its import finding.
- **One effective balance** (`credit_notes::NET_SQL` / `PAID_SQL`), used by every screen and the PDF; the TypeScript domain mirrors it:
  - net = total + credit notes;
  - paid = payments without reversal + credit in − credit out.
- **Credit moves only within the same family and institution** (CONSTITUTION: the legal entities are never mixed).

**Why:** an issued invoice is part of the books and cannot be changed or deleted, but mistakes must be correctable before go-live (forensic finding K4). Appended records keep the full history for the accountant and the audit log (BR-30).

**Verified:**
- cargo test 48/48:
  - migration 010 under data of every kind (E-19);
  - 7 credit-note tests for S1–S6;
  - migration 011 on a database that applied the first 010 (L-S3-11).
- Vitest 184/184.
- Real-data end to end: 1.569 invoices, 251 findings, credit-note series IDSS 2026 = 35, 0 FK violations.
- The Director issued a trial credit note in the running app (2026-11-21, C-13).

---

## DL-P012 — Accounting-complete invoice PDF in the layout of the institutions' document (F1)

**Date:** 2026-11-21 · **Spec:** `specs/invoice-pdf-complete/` · **Source:** `IMH-IDSS-Fakturisanje.html` and its sample `Faktura_IMH_004_26.pdf` (Director: the document is used to the maximum); Director 2026-11-21 (logo, slip in the bottom third, QR)

**Decision:**
- The PDF follows the sample invoice:
  - letterhead with logo, ID and transaction account;
  - title and **Code 39 barcode of the whole number**;
  - box with period, issue date, due date, place of issue (Sarajevo) and method of payment (Virman / Nalog za plaćanje);
  - buyer box;
  - **10-column table** (JM, Količina, Cijena, S rabatom, Rabat %, PDV %, PDV iznos, Iznos bez PDV);
  - PDV note box;
  - **recapitulation** (Prodajna vrijednost, Iznos odobrenog rabata, Vrijednost bez PDV, Iznos PDV 0 %, UKUPNO);
  - amount in words;
  - payment slip with QR;
  - signatures (Fakturisao/la, M.P., Ovlašteno lice, Komitent).
- **The payment slip and the signatures take the bottom third of the last page** (Director, 2026-11-21). The body flows above it and continues on further pages.
- **Amount in words uses the document's wording** („šest stotina osamdeset i 00/100 KM“). It is identical to the document's `slova` for 100.000 random amounts; above one million the same style continues.
- **Due date:** the 5th of the month; when the invoice is issued after it, the **issue date + 5 days** (document `dueFor`, sample 14.10 → 19.10). This replaces „due on the issue date“.
- **PDV note:** IMH gets the document's sentence by default (seed, and migration 012 for empty notes; an entered note is never overwritten). Below it, always: „Dokument je izrađen na računaru, i punovažan je bez potpisa i pečata.“ and the TRN line (not on credit notes).
- **Kept from later decisions, over the 19.10 document:**
  - QR label „QR kod za plaćanje“ (DL-P008 addendum, 21.10);
  - slip purpose = number, child, period (IDSS Pravilnik čl. 3);
  - place and date of payment left blank for the parent (DL-P008);
  - one buyer on the invoice (BR-24), so no „Majka:“ line.
- **Corrected from the document:** its barcode encoder dropped every non-digit („IMH 004/26“ → 00426). The full Code 39 set is used and verified by decoding.

**Verified:**
- Vitest 205/205:
  - recapitulation identities for 10.000 random invoices;
  - barcode decoded back;
  - month-end and leap-year due dates.
- cargo test 49/49 (migration 012).
- Rendered and viewed:
  - one-line invoice (one page);
  - 24-line IDSS invoice (two pages, slip on the last);
  - credit note (no slip, the barcode does not overlap the long title);
  - all against the sample invoice.
- **Open:** the PDV sentence for IDSS (P.U., not PPU), for the accountant.

## DL-P013 — Manual invoice for services outside the price list (F2)

**Date:** 2026-11-21 · **Spec:** `specs/manual-invoice/` · **Source:** `IMH-IDSS-Fakturisanje.html` (`vNew`, `saveNewInvoice`), CONSTITUTION BR-7, BR-9, BR-10, BR-24, BR-26, BR-27

**Decision:**
- „Novi račun“ on „Računi“ issues an invoice of kind `OTHER` for **one child of one institution**:
  - lines: Naziv, JM (`kom` / `srv`), whole Količina 1–999, Cijena; Ukupno = količina × cijena in fenings;
  - period: the billing month;
  - due date: the document's rule (DL-P012), which the operator may change;
  - number: the institution's series (BR-23);
  - **basis** („Osnov“: decision, contract or notice): mandatory, stored in `invoices.reason`, written to the audit log and shown in the detail.
- **Taken over from the document:** the fields, the totals and the validation messages (M1–M7).
- **Not taken over, because the constitution decides otherwise:**
  - **Rabat %** — any reduction needs a board-decision record (BR-7), and the register does not exist yet. A manual line is always at its entered amount.
  - **Quick pick from the price list** — all 33 catalog rows are already billed by rule: through the monthly bulk (BR-26), or through „Račun za upis“ with the continuing-child and transfer rules (BR-9, BR-10). A manual copy could bypass those rules or bill twice. The screen points to those flows.
  - **„+ Nova porodica“ / „+ Dodaj dijete“** — families and children are created in „Porodice“ with their validations.
  - **The number preview** — the backend assigns the number in the issuing transaction.
- The rules are enforced again in Rust: a manual invoice carries only `OTHER` lines and no other kind may; amount = list amount (no discount, no decision); the amount is divisible by the quantity; a unit; a basis; a total above 0.
- **Migration 013** adds `invoice_lines.quantity` (default 1, 1–999) and `invoice_lines.unit`. Earlier lines keep quantity 1, and their JM is still derived from the item code, so their PDFs are unchanged.
- PDF: Cijena and S rabatom per unit, Iznos bez PDV per line.
- **Monthly bulk:** an app invoice of kind `OTHER` no longer counts as „already invoiced this month“. Otherwise summer school would stop the August tuition. Imported invoices (`OTHER`, `LEGACY`) still count (BR-32).

**Verified:**
- Vitest 217/217:
  - every M5 message;
  - entity from the enrolment;
  - school year of the month;
  - 5.000 random manual invoices equal quantity × price to the fening;
  - recap with quantity;
  - PDF with quantity 3;
  - the monthly-bulk predicate.
- cargo test 52/52:
  - manual round trip;
  - eleven rejections, with no number used;
  - a monthly invoice still allowed after a manual one;
  - migration 013 rehearsal on a database at 012 (E-19).
- **Director check (C-13):** confirmed in the running app, 2026-11-21 (with amendments 1 and 2). **Open:** discounts and scholarships wait for the board-decision register.

**Amendment 1 (2026-11-21, Director's check — amends DL-P012):** an invoice of 710,00 reduced by a 705,00 credit note printed „UKUPNO ZA UPLATU 710,00“ and „Slovima: sedam stotina deset“, and showed the reduction only in a small line below the table. The Director: „treba da plati samo 5,00 KM“.
- The recapitulation now adds „Iznos računa“ and one row per credit note („Knj. odobrenje <broj>“). The dark **UKUPNO ZA UPLATU** row is the amount due after the credit notes, and **Slovima** states that amount.
- The slip, the QR and the export mail list use the same figure (`amountDue`, M-7).
- With more than five recap rows they are 15 pt high, so the slip stays in the bottom third of page 1.
- „Dokument je izrađen na računaru…“ is printed once, also when the institution's note already contains it (it appeared twice on the trial database).

**Amendment 2 (2026-11-21, Director — amends DL-P011 and DL-P008):** „Uplaćeno 5,00 KM · preostalo za uplatu 0,00 KM“ must not be on the invoice. The invoice is issued before the parent pays, and they pay on receiving it.
- The PDF of an invoice **never prints payments**, and it reads the same whenever it is printed or sent.
- The payment slip and the QR ask for UKUPNO ZA UPLATU (`slipAmount`: the invoice after its credit notes, never reduced by payments). This replaces DL-P008 „amount = what is still open“.
- The payment status stays in the invoice register and the invoice detail („Uplate“).

## DL-P014 — One invoice per child with all its costs; manual invoice only for children not enrolled

**Date:** 2026-11-21 · **Spec:** `specs/one-invoice-per-child/` · **Source:** Director, 2026-11-21. The HTML document does not settle it: its monthly bulk makes a tuition line only, and its manual invoice allows anything. **Amends:** DL-P013 (F2), the enrolment-fee invoice of Sprint 03, CONSTITUTION BR-27.

**Director:**
- „Za jedno dijete svi troškovi idu na jedan račun. Na primjer: školarina za decembar 2026 710,00 KM, upisnina, potrošni materijal…“
- „Ručni račun … samo za usluge koje se privremeno koriste i isključivo za novu djecu (npr. dijete pohađa samo našu ljetnu školu, a inače je redovno upisano u neku drugu školu).“
- „… operaterka koja kreira račun potvrdi tačnost i po potrebi odredi … šta će se na tom računu prikazati.“

**Decision:**
- **The monthly preview builds one invoice per child and institution.** It contains:
  - tuition (IDSS: the plan instalments due and breakfast);
  - every one-time item of the enrolment **not yet billed**: enrolment fee, materials, deposit. They follow the existing rules: continuing child, transfer Preschoolers → IDSS Preschoolers, sibling tier of the deposit, reduced IDSS fee.
- An IDSS pupil with no instalment due that month still gets an invoice for its unbilled one-time items.
- **The operator confirms each invoice and decides what it shows:**
  - every line has a tick, and the whole invoice can be left out;
  - a one-time item left out is proposed again the next month;
  - an excluded IDSS instalment is not marked invoiced;
  - a **service outside the price list** can be added with its basis;
  - price-list amounts are never edited (BR-7).
- **Proposed but not ticked:**
  - the IDSS deposit (the school's decision, only with 2+ instalments);
  - an item already found on an **imported** invoice of the old workbook (from March of the year before the school year). The note names that invoice, because those invoices carry no enrolment and only the operator can judge.
- **„Račun za upis“ is removed** from the family card. Existing invoices of kind `ENROLMENT_FEES` stay valid and count as billed.
- **„Novi račun“ (manual) only for a child not regularly enrolled** in the institution in that school year: no enrolment other than withdrawn. A withdrawn enrolment does not count; a completed one does.
  - Its lines carry no enrolment and no program.
  - An enrolled child's extra services go on its monthly invoice.
- **Rust enforces:**
  - a one-time item at most once per enrolment, across all issued invoices; the two enrolment-fee codes are one item, and a cancelled invoice frees it (S6);
  - `OTHER` lines only on monthly or manual invoices, with a basis;
  - lines without a program only on a manual invoice;
  - a manual invoice is refused for an enrolled child.
- New command `list_billed_one_time(school_year)` tells the preview what is already billed.
- **Due date:** the monthly one (the 5th, or issue + 5 days). One-time items therefore no longer have their own due date (BR-9 „before the child starts“, BR-10 „7 days“). The status `AWAITING_ENROLMENT_PAYMENT` still waits for the payment.

**Verified:**
- Vitest 226/226, including nine cases of the monthly preview:
  - new child in December;
  - siblings;
  - already billed;
  - continuing child;
  - imported invoice;
  - IDSS deposit and plan;
  - IDSS without an instalment;
  - operator's exclusions;
  - an extra service with its basis.
- cargo test 57/57, including the one-time guard, extras on the monthly invoice, and the manual invoice refused for an enrolled child.
- **Director check (C-13):** confirmed in the running app, 2026-11-21, after amendments 1 and 2.

**Amendment 1 (2026-11-21, Director's check).** The December preview was empty: children imported from the old workbook have no enrolment. Its sheet `Setting` holds only father, mother, child and address, with no program and no date of birth.
- The preview now lists every child without an enrolment in the school year, and how many of them were imported, instead of a silent „nema računa“ (E-5).
- New screen **„Upis djece bez upisa“** (Porodice):
  - one table for all such children;
  - the institution is suggested from the child's latest invoice;
  - program, date of birth, residency, start and status are entered by the operator, never guessed (M-4);
  - ticked complete rows are saved in ONE transaction (`save_enrolments_bulk`), audited, and the child's import-review flag is cleared.

**Amendment 2 (2026-11-21, Director):** „Kategorija Toddler/Preschooler nije relevantna … dijete po procjeni pedagoga prelazi iz toddler u preschooler, a cijena je ista.“
- **Toddlers / Preschoolers is one choice** in every form; a new enrolment is stored as `PRESCHOOLERS`.
- The code `TODDLERS` stays valid for stored data and the price list, with the same price, and both read „Toddlers / Preschoolers“.
- No migration.
- IDSS Preschoolers stays separate (other price).
- The direct transfer to IDSS Preschoolers (BR-9) counts from either code.

## DL-P015 — Edge-to-edge responsive layout; templates for every free-text entry

**Date:** 2026-11-21 · **Source:** Director, 2026-11-21: „neke ćelije se odsijecaju … UI za sve uređaje, platforme i veličine ekrana; desktop i laptop preko cijelog ekrana od ivice do ivice … ponudi operateru gotove šablone … svi unosi moraju biti identične sintakse.“

**Decision — layout:**
- The window opens **maximized** and can shrink to 360 × 560 (was a fixed 1366 × 860, minimum 1024).
- The shell has a sidebar from laptop width (lg). Below that, a top bar with a slide-in menu. The content uses the full width with small margins.
- Table cells **wrap** instead of being cut off; amounts (`tabular-nums`) never break.
- The invoice register hides secondary columns on narrow screens: Kupac below md, Rok below lg, Uplaćeno below sm.
- Wide dialogs use up to 96 % of the window (max 96 rem); on a phone every dialog is full width.

**Decision — templates (`invoices/text-templates.ts`, component `TemplateText`):**
- Every free-text entry on invoices and payments is a **template** with typed fields: month from a list, year, school year, date picker, number, short name. The text is assembled in one place, so the same fact is always written the same way.
- Covered entries:
  - payment reference (Izvod br. … od …, Priznanica …);
  - payment purpose (Uplata školarine za {mjesec} {godina}, upisni troškovi, po računu …). This was a new field: payments had an empty note;
  - payment-reversal reason;
  - credit-note reason;
  - credit move / refund note;
  - basis (obavijest, odluka UO IMH / ŠO IDSS, ugovor);
  - description of a service outside the price list (ljetna škola — sedmica, izlet, dodatni program, radionica, ostala usluga).
- A missing or malformed field gives no text, so the entry cannot be saved.
- „Uplatio/la“ stays a name field: it is a person, not a sentence.

**Verified:**
- Vitest 233/233; the template tests cover syntax, rejection of malformed fields and defaults.
- tsc, eslint and build are clean.
- **Director check (C-13):** confirmed in the running app, 2026-11-21.

---

## DL-P016 — Dashboard and audit-log viewer (F3)

**Date:** 2026-11-21 · **Spec:** `specs/dashboard-audit/` · **Source:** CONSTITUTION BR-29, BR-30; the HTML document `vDash` (it records changes but has no screen to view them)

**Decision:**
- **„Kontrolni panel“** is the first menu item and the start page, as in the document. It has:
  - a filter Sve / IMH / IDSS and a month;
  - the cards Aktivni upisi (IMH · IDSS · families), Neplaćeni računi (count, open, of which overdue), Djelimično plaćeni (paid, rest) and Fakturisano u mjesecu;
  - a stacked bar of how the month's invoices are paid;
  - the 8 latest invoices, which open the invoice detail and the PDF.
- **Shared rules for every figure:**
  - one balance definition (`invoiceBalance`, M-7);
  - credit-note documents and cancelled invoices are left out;
  - overpaid counts as paid;
  - amounts are after credit notes, as on the invoice.
- The bar is plain DOM; no chart library (M-12).
- **„Dnevnik izmjena“** is read-only and newest first, paged by 200. It filters by period, kind of change and text.
  - Each object is named: invoice number, invoice of a payment, family, child, enrolment. A deleted record reads „(obrisano)“.
  - Names are resolved at display time, so the log itself still holds no personal data (BR-22). There is no command to change it.
- Every backend action and entity has a Bosnian label. A test reads the Rust sources and fails when a new code has none; an unknown code is still shown.

**Verified:**
- Vitest 243/243, including:
  - every card for both institutions;
  - the bar segments equal the invoiced amount and Σ open equals „Otvoreno“ on Računi, for 2.000 random registers;
  - IMH and IDSS are never mixed;
  - label coverage.
- cargo test 57/57, including name resolution, deleted records, filters, paging and 10.000 entries.
- **Open:** the Director's check in the running app (C-13).

---

## DL-P017 — One canonical format for every entered value; search in the invoice register

**Date:** 2026-11-21 · **Source:** Director, 2026-11-21: „svako polje za unos mora imati presretanje greške i dozvoljene formate … ne može broj telefona jednom biti 033562114 a drugi put +387/33 561-226 … odnosi se na sva polja“; „na Računi mora biti efikasno pretraživanje“.

**Decision — formats (`src/lib/validation/formats.ts`, form schemas in `schemas.ts`):**
- Every field accepts the usual ways of typing a value and saves its ONE canonical form; anything else is refused with the allowed format in the message.
- Under each field „Format: …“ shows what is expected.

| Value | Canonical form |
|---|---|
| Telephone, fax, mobile | `+387 33 562 114` · `+387 60 345 1275` · foreign E.164 `+4917612345678` |
| E-mail | lower case, `ime@domena.ba` |
| IBAN | `BA39 1990 4900 5848 7943`, check digits verified |
| Transaction account | `1990 4900 5848 7943`, control digits verified |
| SWIFT / JIB / web | `ABSBBA22` · 13 digits · `www.domena.ba` |
| Address | `Ulica i broj, 71000 Sarajevo`; house number or „bb“ required |
| Names | capital initial, single spaces, hyphen without spaces; no digits; full name = at least two words |
| Document numbers | `12/26`, `02-1-123/26` |
| Board decision | template „Odluka ŠO IDSS br. … od …“ |
| Dates | real calendar date; dates of birth, payments and acts not in the future; dates of birth not before 1990 |
| Recovery key | 44 characters as printed |

- **Covered forms:**
  - family and guardians;
  - child;
  - operator;
  - institution;
  - ministry approval;
  - board rules;
  - payment (payer, date);
  - bulk enrolment;
  - backup restore.
- Invoice texts already use templates (DL-P015).
- Stored data is **read** with the lenient schemas, so imported records still load. A record gets its canonical form when it is next saved.
- The institutions' master data passes unchanged, except the postal code, which is written `71000`.
- **Rust checks again on save:** telephone, e-mail and IBAN of guardians and institutions, in `formats.rs`, without a new dependency (M-12).

**Decision — search („Računi“):**
- One field finds an invoice by number, child, buyer or family.
  - Case and diacritics are ignored; „đ“ may be typed „dj“ or „d“.
  - The number is found however it is typed: „12/26“, „imh 12 26“, „IMH-012/26“.
  - Several words must all match.
- A status filter (incl. „Dospjelo, a neplaćeno“ and „Knjižno odobrenje“) sits beside the institution and month filters.
- „Prikazano N od M“; the totals follow what is shown.

**Verified:**
- Vitest 256/256, including every format with its loose spellings, the institutions seed, the form schemas and the search.
- cargo test 60/60, including the canonical checks.
- **Open:** the Director's check in the running app (C-13), together with F3 (DL-P016).

---

## DL-P018 — Deleting what was entered by mistake; the system proposes, the operator approves

**Date:** 2026-11-21 · **Review:** `docs/ux/TOKOVI-OPERATERA.md` · **Source:** Director, 2026-11-21: „brisanje unesene stavke nije u funkciji … revizija logike kretanja operatera … gdje god je moguć automatski unos … iznos mjesečne rate treba da sistem sugeriše, a operater da odobri“.

**Decision — deleting:**
- A family, child or enrolment entered by mistake is deleted **whatever its status**, as long as nothing of it was ever invoiced. Before, an enrolment could be deleted only while „Čeka upisne uplate“, a child only without enrolments, and a family only without children.
- Deleting the family takes its children, enrolments and guardians with it. Deleting a child takes its enrolments. Deleting an enrolment takes its never-invoiced payment plan and its breakfast. All of it happens in one transaction.
- Every delete asks for **confirmation**, naming what will be deleted (`useConfirm`).
- Anything on an issued invoice is refused, and the message names the invoice. Accounting records are never deleted; the child is withdrawn instead.
- **Deviation:** this is an explicit, guarded removal of unbilled dependents, not a database cascade (A-10).

**Decision — the system proposes:**
- **Payment plan:** `defaultIdssPlan` proposes 10 instalments September–June (BR-5) at the price-list amount with the sibling tier, or fewer when the board's last-instalment deadline requires it.
  - The plan dialog opens with this proposal;
  - after an IDSS enrolment is saved, the dialog opens by itself;
  - in the monthly preview every IDSS pupil without a plan is listed with the proposed plan and „Prihvati predložene planove“.
- **Flow without searching:** a new family opens with its first-child form; a new child opens its enrolment; an IDSS enrolment opens its plan.
- Further proposals (automatic activation, next-year enrolments, bank-statement matching, reminders) are listed in the review and wait for the Director.

**Verified:**
- Vitest 259/259, including the proposed plan (10 instalments, sibling price, board deadline).
- cargo test 60/60: an active unbilled enrolment, child and family are deleted; anything invoiced is refused with the invoice number.
- **Open:** the Director's check in the running app (C-13).

---

## DL-P019 — Guided flow for the FAS: home screen, institution, steps in the institution's colours

**Date:** 2026-11-21 · **Spec:** `specs/guided-flow/SPEC.md` · **Definition:** `docs/DEFINICIJA-APLIKACIJE.md` §4 · **Source:** Director, 2026-11-21 (product definition, „STOP. Imamo generalni problem u razumijevanju …“); the layout of the steps was approved with the clarifications for B and E.

**Decision:**
- **Home screen:** „Dobar dan, <ime>. Šta ćemo danas raditi?“, with three cards: 1. Fakturisanje, 2. Ostalo fakturisanje, 3. Izvještavanje. The name comes from the operator profile at runtime; it is never in the code (BR-22).
- **Institution first:** after choosing the job the FAS picks IMH or IDSS. From then on the screen carries the institution's colour, and the header shows the job and the institution with „← Nazad“ and „Početna“.
- **One institution per flow** (Director, 2026-11-21: „u IDSS samo IDSS, u IMH samo IMH“). Every list, problem, child without an enrolment and invoice in a flow belongs to that institution only. A child whose institution is not known yet (no enrolment, no invoice) appears in both.
- **Fakturisanje, steps A–E** (next month by default):
  - A. Provjeri spisak djece;
  - B. Kreiraj fakture, bulk or for one child;
  - C. Štampaj, as PDF or DOCX;
  - D. Pošalji Office Manageru, as an Outlook draft;
  - E. Prati naplatu.
  Finished steps get ✓ and the next one is highlighted.
- **B. Kreiraj fakture:** the system recognises earlier billing. A continuing child gets only the tuition instalment (plus breakfast or extended stay). A newly enrolled child gets the instalment, enrolment fee, deposit and materials.
- **E. Prati naplatu:** a partial payment leaves the invoice „Djelimično plaćena“ with its remainder, and the next payment proposes the remainder. A surplus becomes family credit (DL-P011).
- **Ostalo fakturisanje, steps A–C:**
  - A. unesi fakturu/e: a service from the templates, for one or more children (bulk), one invoice per child;
  - B. štampaj;
  - C. pošalji.
- **Amendment to DL-P014:** an „other service“ (ljetna škola, sekcija, izlet …) can be billed for any child, enrolled or not. It always goes on its own invoice; the monthly invoice holds only price-list items.
- **„Dopuna podataka o djeci — školska X“** replaces the confusing name „Upis djece bez upisa“ (Director, 2026-11-21).
- **Data and settings** (families and children, price list, audit log, settings, review findings) stay in the top bar, outside the flows.

**Verified:**
- Vitest: the problems and children without an enrolment are attributed to their institution, and each flow filters them.
- The flows were built from the Director's corrections in the running app (screenshots of 2026-11-21).
- **Open:** the Director's final check of the flows in the running app (C-13).

**Amendment 1 (2026-11-22) — lists split exactly by institution.** Source: Director, 2026-11-22: „Ovaj dječak je isključivo pohađao IDSS … spiskovi moraju biti hirurški precizno podijeljeni na IMH i na IDSS“ (an IDSS-only family appeared in IMH „Pojedinačno — jedno dijete“).
- **Cause:**
  - the family list of „Novi račun“ was not filtered at all;
  - children were filtered by enrolment only;
  - a child with no data was shown in both institutions.
- **One rule for every list of a flow** (`src/features/families/membership.ts`):
  1. an active enrolment in this or a later school year;
  2. otherwise the latest invoice;
  3. otherwise the latest enrolment of any year.
  A child with none of these is in **no** list. Its institution is set in „Dopuna podataka o djeci“ by choosing the program.
  A family is shown when at least one of its children belongs to the institution, and only those children are offered.
- **Applied in:**
  - „Pojedinačno — jedno dijete“ (families and children);
  - „Ostalo fakturisanje“;
  - „Djeca bez upisa“ in step A (children of unknown institution are only counted);
  - „Dopuna podataka o djeci“ opened from a flow.
- **Real data** (the legacy workbook, counts only):
  - children: 124 IMH, 113 IDSS, **0 in both**, 244 of unknown institution;
  - families: 94 IMH, 79 IDSS, 8 in both (siblings in both institutions, each child only in its own), 185 none.
- **The 244 children of unknown institution** are only in the old Excel register („Setting“, which has no institution column), with no invoice and no enrolment. The Director, 2026-11-22: „Bivša djeca, ostavi“. They stay in no list; a child who returns gets its institution in „Dopuna podataka o djeci“.
- **Verified:** Vitest 279/279, including:
  - an IDSS-only pupil (by enrolment, by invoice, by an old enrolment) never in IMH;
  - IMH Preschoolers moved to IDSS shown in IDSS;
  - siblings in both institutions;
  - a child of unknown institution in neither list.

---

## DL-P020 — Reporting is read-only; register exports in XLSX, CSV and DOCX

**Date:** 2026-11-21 · **Source:** Director, 2026-11-21: „Izvještavanje je operacija nad postojećim podacima … zašto se ovdje dozvoljava unos faktura?“; „u IDSS se mogu pozvati IMH informacije i obratno — nelogično“; DEFINICIJA M5, M7.

**Decision:**
- **„3. Izvještavanje“ only reads.** It has no entry, no payment, no storno and no new invoice. The register and the invoice detail open with `readOnly`.
- **One institution only:** reporting for IMH shows only IMH and reporting for IDSS only IDSS. There is no institution selector inside it.
- **Tabs:**
  - Kontrolni panel (compact);
  - Registar faktura (search and status filter);
  - Izvoz (XLSX, CSV, DOCX).
  The audit log covers the whole application and stays in the top bar.
- **Exports** of the invoice register for a period (from the start of the school year to today by default):
  - **XLSX** with four sheets: Sažetak, Fakture, Po mjesecima, Otvoreno po porodicama. Written with fflate; `src/lib/export/xlsx.ts` is shared with the import report.
  - **CSV:** UTF-8 with BOM, `;` as separator and decimal commas, so Excel opens it with Bosnian letters. Formula characters are neutralised.
  - **DOCX report** on the letterhead (DL-P021).
- **Invoice DOCX** (M5) carries the same figures as the PDF. The payment slip stays in the PDF.
- **Shared rules:** every figure uses the register's balance definition (M-7), and no new dependency is added (M-12).

**Verified:**
- Vitest, including totals with a partial payment, credit-note documents and cancelled invoices left out, the BOM bytes, formula neutralisation, the four XLSX sheets, and DOCX invoice figures equal to the PDF.
- **Open:** the Director's check of read-only reporting in the running app (C-13).

---

## DL-P021 — Official documents on the institution's letterhead, A4

**Date:** 2026-11-21, amended 2026-11-22 · **Source:** Director, 2026-11-21: „Izvještaji su zvanični dokumenti i moraju biti na pripadajućim memorandumima“ (MEMORANDUM_IMH.dotx, MEMORANDUM_IDSS_OD_20042026.dotx); 2026-11-22: „Izvještaji moraju biti na A4 formatu“.

**Decision:**
- **Letterheads:** the institutions' Word templates are bundled as `src/assets/letterheads/imh.dotx` and `idss.dotx`, inlined at build time (`?inline`, `assetsInclude`). There is no network access and no CSP change. The author's name is removed from their metadata (BR-22).
- **How a document is built** (`onLetterhead`):
  - the template's sample body is replaced by the document;
  - header (logo), footer (institution data), styles, images and margins stay as they are;
  - the content type becomes a document, so Word opens it as a finished file.
- **Which documents:**
  - the DOCX report: place and date „Sarajevo, <datum> godine“, summary, months, largest open amounts, and „Izvještaj sastavio/la: ____“;
  - the DOCX invoice of that institution. On the letterhead the institution data is in the footer, so it is not repeated in the body.
- **A4:** every letterhead document is A4 portrait (210 × 297 mm), whatever paper size the template was saved with. The IMH template is US Letter.
- **Tables:** a table wider than the letterhead's text area is scaled down to it.

**Verified:**
- Vitest 275/275, including: the letterhead package, the template body replaced, the section kept, tables fitted, and A4 for both real templates.
- Word opened all four samples (an invoice and a report for each institution), reported 210 × 297 mm and one page each, and exported them to PDF.
- Build: both letterheads are in the bundle.
- **The Director checked the samples (2026-11-22, C-13).**

---

## DL-P022 — Every field: a template, and the possibility to write it differently

**Date:** 2026-11-22 · **Source:** Director, 2026-11-22: „Ljetna škola traje dvije sedmice, ali može se dijete upisati i samo jednu sedmicu. Za svako polje mora postojati šablon, ali i mogućnost da se drugačije unese. To vrijedi za cijelu aplikaciju.“ · **Amends:** DL-P015, DL-P017.

**Decision:**
- **Template fields** (`TemplateText`): every invoice service, basis, payment purpose and reference, storno and reversal reason, credit movement, and board decision.
  - A field with proposed values offers them in a list, but any other value can be typed.
  - Every template list ends with **„Drugačije — upišite sami“**. It opens with the text the template gave, so a small change needs no retyping.
  - The free text is only tidied (single spaces, capital initial) and checked: 2–120 characters, no control characters.
- **Summer school:** one template, „Ljetna škola {godina} — {sedmice}“. „1. i 2. sedmica“ is proposed; „1. sedmica“ and „2. sedmica“ can be chosen, and any other value typed. The quantity stays the operator's, e.g. 2 × the weekly price for both weeks.
- **Unit of measure (JM):**
  - srv, kom, sedm., dan, mj. and čas are proposed, and any other short unit can be typed (`normalizeUnit`: letters and dots, up to 10, lower case).
  - The backend checks the same.
  - **Migration 014** rebuilds `invoice_lines` with a relaxed unit check. Every row and column is copied unchanged, as in 008.
- **Fields with a fixed format stay checked:** telephone, e-mail, IBAN, account, JIB, address, names, document numbers.
  - They accept many ways of typing and save one form (DL-P017).
  - A value that cannot be right (for example an IBAN with a wrong check digit) is still refused, because it protects the invoice and the payment slip.
- **Unchanged:** fixed choices that define the accounting (institution, program, enrolment status, kind of invoice) have no free entry.

**Verified:**
- Vitest 282/282:
  - summer school with both weeks, one week, or another value;
  - free text tidied and refused when empty, too long or with control characters;
  - units.
- cargo test 61/61: migration 014 keeps every line unchanged, accepts „sedm.“, and refuses an empty, padded, numeric or too long unit; the backend line check too.
- The running app applied migration 014 to the trial database.
- **Open:** the Director's check in the running app (C-13).

---

## DL-P023 — Nothing is invoiced twice to the same child for the same period

**Date:** 2026-11-22 · **Source:** Director, 2026-11-22: „Probao sam da kreiram fakturu za istu osobu, za istu uslugu, za isti period i sistem to dozvoljava. Nevjerovatna fundamentalna greška.“ · **Lesson:** L-S3-15.

**Audit of every kind of invoice:**

| Kind | Guard before | Guard now |
|---|---|---|
| IMH monthly (`MONTHLY`) | unique index per child, institution, month | unchanged, plus the same check in code with the existing number in the message |
| IDSS monthly (`INSTALMENT`) | only each plan instalment once; **no guard for a second invoice of the month** | one monthly invoice per child, institution and month — `MONTHLY` and `INSTALMENT` together |
| Enrolment fees (`ENROLMENT_FEES`) | unique index; each one-time item once per enrolment | unchanged |
| Other services (`OTHER`) | **none** | the same service, with the text compared without case and spacing, is not billed again to the child for the same month. This holds on a manual or a monthly invoice, and twice on one invoice. |
| Credit note | linked to its invoice, never above the remainder (DL-P011) | unchanged |

**Decision:**
- **Checked in the backend** (`ensure_not_billed_twice`), in the issuing transaction, so no screen, bulk action or later change can bypass it.
  - The refusal names the existing invoice, e.g. „„Ljetna škola 2026 — 1. sedmica“ je ovom djetetu za taj mjesec već fakturisano (IDSS-012/26)“.
  - In a bulk action nothing is issued until it is fixed.
- **Said before creating:**
  - **„Ostalo fakturisanje“:** a child who already has the service in that month shows „već fakturisano za ovaj mjesec (broj)“. The child cannot be ticked, and „Označi sve“ skips them.
  - **„Novi račun“:** a manual line that repeats a billed service is listed, and „Kreiraj račun“ stays disabled.
  - The screens read the billed services with the read-only command `list_billed_services` and compare with the backend's rule (`serviceKey` = `service_key`).
- **Still allowed:**
  - a different service (another week, another trip);
  - the same service in another month;
  - a new invoice after the earlier one was credited (`CANCELLED`).
  A correction is made by storno, or later by „Ispravi fakturu“ (M8).
- **The duplicate the Director created** in the trial database stays as issued. It is corrected by a credit note (storno) of one of the two invoices.

**Verified:**
- cargo test 62/62. A new test covers:
  - the same text in another case and spacing;
  - the same line twice on one invoice;
  - the same service on the monthly invoice;
  - another service, another month and a credited invoice are allowed;
  - a second monthly invoice, IMH `MONTHLY` or IDSS `INSTALMENT`, is refused.
  The numbering test now issues 150 different services instead of 150 identical ones.
- Vitest 283/283.
- **The Director checked it in the running app (2026-11-22, C-13): „Da, odbija“.**

---

## DL-P024 — The invoice PDF fits on one page with the payment slip, up to 12 lines

**Date:** 2026-11-22 · **Source:** Director, 2026-11-22: „PDF računi na dvije stranice. Zašto?“ · **Amends:** DL-P012 (F1 layout) · **Lesson:** L-S3-16.

**Cause:**
- The payment slip and the signatures have a fixed place in the bottom third of the last page.
- Above them the layout (letterhead, facts box, rows of 22 pt, notes and recapitulation) had room for only **4 lines**.
- Since all of a child's costs go on one invoice (DL-P014), a new child has 5–7 lines (instalment, enrolment fee, deposit, materials, breakfast, extended stay, extra services). The body then crossed the slip by a few millimetres, and the whole slip went to page 2.

**Decision:**
- **Compact layout:**
  - logo 48 pt, letterhead text 7.5 pt;
  - tighter gaps;
  - facts and buyer box 12.5 pt per row;
  - table header 17 pt, rows 16 pt;
  - recapitulation rows 16 pt (14 pt with credit notes);
  - notes 7.5 pt.
  The amounts, the title and the slip keep their sizes.
- **More than 8 lines:** denser rows of 12 pt with 7.5 pt text.
- **Result:** up to 12 lines fit on one A4 page with the slip and the signatures, with or without credit-note rows. Before, the limit was 4. Only a larger invoice continues on a second page, as before, with the slip on the last page.

**Verified:**
- Vitest 284/284. A new test renders 5–12 lines, with and without a credit note, and expects one page.
- Samples looked at: 7 lines with a credit note (IMH), 12 lines (IDSS).
- **The Director checked the samples (2026-11-22, C-13): „Da, ispravno“.**

---

## DL-P025 — A child's date of birth must fit the child and the program

**Date:** 2026-11-22 · **Source:** Director, 2026-11-22: „Presretanje greške nije u funkciji — dozvolio mi je da formiram upis u vrtić za dijete rođeno 1998. godine.“ · **Amends:** DL-P017 · **Lesson:** L-S3-17.

**Cause:** the only check on a date of birth was „not in the future, not before 1990“. A 28-year-old passed, and nothing compared the age with the program.

**Decision:**
- **Child:** no older than **16** on the day it is saved, and the date of birth is not in the future. This is checked in the child form, in „Dopuna podataka o djeci“ and in the backend (`save_child`).
- **Enrolment:** the child's age on the program's first day (completed years) must fit the program. This is checked in the enrolment form, in „Dopuna“ and in the backend (`save_enrolment`). The message names the age and the allowed range.

| Program | Age on the first day |
|---|---|
| Toddlers / Preschoolers (IMH) | 0–6 |
| IDSS Preschoolers | 3–6 |
| Osnovna škola I–IV | 5–11 |
| Osnovna škola V–IX | 9–16 |

- These are **wide guards against impossible dates**. The HTML document gives no ages, so the exact ranges are for the Director to confirm.
- An imported child without a date of birth is not judged until the date is entered in „Dopuna“.

**Verified:**
- Vitest: a kindergarten enrolment for a child born in 1998 is refused, and so are a 9-year-old in kindergarten and a 3-year-old in primary school; ages on the day before or after a birthday are correct.
- cargo test 63/63, including the backend refusal.
- **Open:** the Director's confirmation of the ranges (C-13).

---

**Amendment 1 (2026-11-27):** Source: the Director's screenshot. A start of attendance on 02.01.2025 was accepted for the school year 2026/2027, before the child's birth (13.11.2026), and the form showed „ima -2 god.“.
- **Start date:**
  - the start lies in the enrolment's school year (1 September – 31 August), and the end is not before the start;
  - the date field allows only that school year;
  - the form checks while typing and disables „Upiši dijete“;
  - the backend checks again (`save_enrolment`, which had no such check).
- **Before the birth:** the message names both dates: „Početak pohađanja (02.01.2025.) je prije rođenja djeteta (13.11.2026.)“. The age is shown as „2 god. i 3 mj.“ and never as a negative number.
- **Verified:** Vitest 345/345 and cargo test 70/70, with the Director's case as a test on both sides.

---

## DL-P026 — Notice of the unpaid remainder; the issued invoice stays as issued

**Date:** 2026-11-22 · **Source:** Director, 2026-11-22: after a partial payment the invoice printed again „bio je na puni iznos“. Chosen: „Opomena za ostatak“ (the invoice stays a legal document, unchanged; a separate notice for the remainder).

**Cause:** the partial payment was recorded correctly. The status was „Djelimično plaćen“, the remainder was right, and the next payment proposed it. But the invoice PDF never shows payments (Director, 2026-11-21, DL-P013 amendment 2), so the parent had no document for the remainder.

**Decision:**
- **The invoice PDF does not change**: it always states UKUPNO ZA UPLATU after credit notes.
- **„Obavijest o neplaćenom ostatku“** (or „… računu“ when nothing has been paid) is a separate PDF on the institution's letterhead. It contains:
  - the invoice number, date and period, the buyer and the child;
  - the amount due, each payment that was not reversed, and the remainder („OSTATAK ZA UPLATU“), also in words;
  - a short letter;
  - a payment slip and QR code for the remainder only, with the purpose „Ostatak po računu …“ and the deadline the FAS chooses (8 days by default);
  - the signatures.
- It has no number and is not an accounting document.
- **Where:** in the invoice detail, „Obavijest o neplaćenom ostatku…“. This covers step E (Prati naplatu), which opens the invoice detail. It is not offered in read-only reporting, and only while something is still open.

**Verified:**
- Vitest 288/288. Tests cover:
  - the figures (credit notes count, a reversed payment does not);
  - one page;
  - the refusal when nothing is owed.
- Sample looked at: 1.000 KM, 500 paid, 500 left, with a slip for 500.
- **Open:** the Director's check in the running app (C-13).

---

## DL-P027 — No amount above 100.000,00 KM

**Date:** 2026-11-27 · **Source:** Director, 2026-11-27: „PDF računa IMH-907/26 nije napravljen: cannot spell 10000000000000“. An invoice of about 10 trillion KM had been issued from a mistyped price. · **Lesson:** L-S3-18.

**Cause:**
- A price was checked only for form: a number with at most two decimals, not negative.
- There was no upper limit on a price, a line, an invoice or a payment, on the screens or in the backend.
- The PDF then failed on the amount in words, which went up to 999.999.999 KM.

**Decision:**
- **Limit: 100.000,00 KM** (`MAX_AMOUNT`, the same value in `money.ts` and `invoices.rs`). It applies to:
  - a unit price;
  - a line (quantity × price);
  - an invoice total;
  - a payment.
- The forms refuse a higher amount with a message that names the row; the backend refuses it again (`issue_invoice`, `record_payment`). Exactly 100.000,00 KM is accepted.
- **Credit notes** are not capped by this limit: they are bounded by the invoice they cancel. That way an invoice issued before the limit, like IMH-907/26, can be stornoed in full.
- **The amount in words** now goes up to 999 trillion (milijarda, bilion), so that such an invoice and its credit note still print. No new invoice can reach it.
- **IMH-907/26** turned out not to exist on disk: it was lost by the data-loss bug of DL-P029, so there is nothing to storno.

**Verified:**
- Vitest 337/337:
  - price, line and invoice above the limit refused, 100.000,00 accepted;
  - amount in words for billions and trillions;
  - the random test now stays within the limit.
- cargo test 65/65: an invoice or payment above the limit is refused, exactly 100.000,00 KM is accepted.
- **Open:** the Director's check (C-13) and confirmation that 100.000,00 KM is the right limit.

---

## DL-P028 — Names of every alphabet, particles, visible corrections, no placeholder telephone (SPEC registration-validation A5–A8)

**Date:** 2026-11-27 · **Spec:** `specs/registration-validation/` (approved 2026-11-27) · **Source:** the Director's proposal „Parent / Payer Registration — Master QA Standard“ and its analysis.

**Decision:**
- **A5:** names may use the letters of every alphabet with their accents (María, Ramón, Łukasz, Şahin). The accents are kept exactly as typed (NFC). Digits and symbols are still refused, and the backend checks the same on saving a family, parent or child.
- **A6:** the particles `von, van, der, den, de, del, della, di, da, du, la, le, al, el, bin, ibn, ter, zu` stay in lower case inside a name when typed so. The first word of a name always has a capital initial, and mixed case („McKenzie“) is kept.
- **A7:** an automatic correction is shown under the field, e.g. „Ispravljeno — biće spremljeno kao: „Begović““. This covers the family name, address, parent name, e-mail, telephone, IBAN and the child's names. Trimming spaces alone is not reported.
- **A8:** a telephone whose subscriber part is one repeated digit („+387 61 111 111“) is refused on the screens and in the backend. A sequence („+387 61 123 456“) is a real number and is accepted, as in the proposal.

**Verified:**
- Vitest: every example of the proposal (§1, §2, §8, §9), row by row, in `registration-examples.test.ts`.
- cargo test: names of every alphabet, refused symbols, placeholder telephones.
- The older tests used a parent named „Roditelj g1“; it now has letters only.
- **Open:** the Director's check in the running app (C-13).

---

## DL-P029 — The last change before closing the app must be on disk (data-loss fix)

**Date:** 2026-11-27 · **Source:** Director, 2026-11-27: an invoice created in „Ostalo fakturisanje“ (IMH-907/26) was gone: „Ovaj račun ne postoji“. · **Amends:** DL-P004 amendment 1 · **Lesson:** L-S3-19.

**Diagnosis:**
- Method: a read-only copy of the database, with technical fields only and no personal data; the copy was deleted afterwards.
- No invoice IMH-907/26 was on disk; the IMH series stood at 906; the audit log had no issue of it and no restore.
- The invoice existed in the running app: its PDF was made from it in step B.

**Cause:**
- Since DL-P004 amendment 1 (2026-11-21, commit 5305459) the encrypted snapshot was serialised **inside** the open transaction, to write the disk before the commit.
- For a database **loaded from disk** (every start but the very first), SQLite serialises only the committed pages. The change being made was therefore missing from the file, and the disk was always **one write behind**.
- The last change before the app was closed or restarted was lost. IMH-907/26 was the last change before a restart.
- The existing test opened a fresh database (first run), where the snapshot does include the open transaction, so it never saw the loss.

**Decision:**
- `Store::write` now commits in memory first, then writes the snapshot of the committed state.
- If the disk write fails, memory is put back to the state before this write, from a snapshot taken at the start of the write. Memory and disk stay equal, and a change reported as failed does not exist, as DL-P004 amendment 1 requires.
- `write_snapshot` must never be called inside an open transaction (doc comment).

**Scope:**
- **Not affected:** the installed version 0.3.0 (2026-10-21). It committed first and then wrote, so data entered there is safe.
- **Affected:** only the development builds since 2026-11-21, i.e. the Director's trial database. In each session there, the last change before closing could be lost. Such a change cannot be recovered and must be entered again if it is still needed.
- The partial payment the Director saw „na puni iznos“ (DL-P026) may also have been such a lost payment.

**Verified:**
- cargo test 66/66. A new test writes, reopens and writes twice more; the last write is on disk after reopening. Before the fix it failed with 2 of 3.
- The failed-disk-write test still passes: the change is undone in memory, the number is not used, and the file is unchanged.
- **The Director checked it in the running app (2026-11-27, C-13):** an invoice issued, the app closed and reopened, and the invoice is there.

---

## DL-P030 — The IMH kindergarten records its group: Toddlers (until the 4th birthday) and Preschoolers (from the 2nd)

**Date:** 2026-11-27 · **Spec:** `specs/registration-validation/` §A9 (approved) · **Source:** Director, 2026-11-27: „Dijete može biti u Toddler grupi samo u dobi 0–3 godine“. The group is recorded; Toddlers until the 4th birthday; Preschoolers from 2 years. · **Amends:** DL-P014 amendment 2 (the single choice „Toddlers / Preschoolers“) and DL-P025 (the 0–6 range).

**Decision:**
- **Two groups, same price:** an IMH kindergarten enrolment chooses **Toddlers** or **Preschoolers**. The price list is unchanged, and „IDSS Preschoolers“ stays a separate program.
- **Age on the first day** (completed years, limits included):
  - Toddlers 0–3, i.e. until the day before the 4th birthday;
  - Preschoolers 2–6.
  Between the 2nd and the 4th birthday both are allowed, because the pedagogue decides. The ranges are the same on the screens (`PROGRAM_AGE`) and in the backend (`program_age`).
- **Proposal:** a new enrolment opens with the group for the child's age on the first day (Toddlers until the 3rd birthday, Preschoolers after it). The form shows the age and the proposal. „Dopuna podataka o djeci“ proposes the group when the date of birth is entered. The operator may change it within the range.
- **„Promijeni grupu“** on an active kindergarten enrolment (command `change_enrolment_group`):
  - Toddlers ↔ Preschoolers from a chosen day, not before the start of the enrolment;
  - the age is checked on that day;
  - it is the same enrolment: no new enrolment fee, deposit or materials, the same price, and issued invoices unchanged;
  - it is written to the audit log as „Promijenjena grupa“.
- **Step A (IMH):** a warning lists the children in Toddlers who turn 4 before the end of the school year, with the date of the 4th birthday.
- **Migration 015:** an enrolment stored as Preschoolers (the old single choice) of a child younger than 2 on its first day becomes Toddlers. Every other enrolment keeps its group, and a child without a date of birth is not changed.

**Verified:**
- Vitest 339/339, including:
  - the limits (3 y 11 m in Toddlers allowed, the 4th birthday refused; 1 y 11 m in Preschoolers refused, the 2nd birthday allowed);
  - the proposal;
  - the 4th birthday, also on 29 February.
- cargo test 68/68:
  - the group change: allowed both ways inside the range; refused out of range, before the start, to the same group, to another program, and on a withdrawn enrolment;
  - migration 015: under 2 → Toddlers; exactly 2, older, and no date of birth unchanged.
- Older tests that put 4–5-year-olds into Toddlers now use younger children; tests about other rules use a child without a date of birth.
- **The Director checked it in the running app (2026-11-27, C-13): „Da, ispravno“.**


**Amendment 1 (2026-11-28) — group change only when the age can fit; a date of birth must fit the open enrolments.**
- **Trigger:** the Director, 2026-11-28: „app dozvolila ponovo upis starijeg djeteta kao toddler pa ga poslije ne prihvata“.
- **Finding (database copy, technical fields only):**
  - A child born 01.01.2020 was enrolled on 28.11. as **Preschoolers**. That is correct: 6 years on the first day, and Preschoolers is 2–6.
  - The card still offered „Promijeni grupu → Toddlers“, which the age never allows. The dialog then refused it, with the wording „na dan početka“.
  - An enrolment saved on 27.11., before the age checks, is still in the database: a child born 1998 in Preschoolers. Nothing reported it.
- **Decision:**
  - „Promijeni grupu“ is shown only when the other group fits the child's age on some day of the school year (`groupChangeFrom`). The dialog starts at that day, and the message says „na dan promjene“.
  - Every active enrolment whose age does not fit is shown in red on the family card („Upis ne odgovara starosti djeteta: …“). It is also listed in step A of the monthly flow, so it is fixed before billing.
  - The backend refuses a changed date of birth that no longer fits an open enrolment of the child; withdrawn and completed enrolments do not count.
- **Verified:** Vitest 349/349 (`groupChangeFrom`: 6 and 4 years never Toddlers, 3 years still Toddlers, Preschoolers from the 2nd birthday, after the school year none; the wording), cargo test 77/77 (a corrected date of birth that no longer fits is refused). **Open:** the Director's check (C-13).
---

## DL-P031 — Possible duplicate family, parent or child: warn before saving

**Date:** 2026-11-27 · **Spec:** `specs/registration-validation/` §B (approved; Q3: warn, block only the same child twice in a family)

**Decision:**
- **Before saving** a new family, an edited family, or a child, the app compares with every family. The comparison ignores case, accents and spaces, as in the invoice search.
- **Possible duplicates** (`duplicates.ts`):

| Record | Possible duplicate when |
|---|---|
| Family | the same family name; a parent with the same name; a parent with the same telephone or e-mail as a parent of **another** family. Two parents of one family may share a home telephone. |
| Child | the same name and date of birth in another family; the same name in the same family (another birth date) |

- **The warning „Možda već postoji“** lists each similar family with its reasons. The operator chooses:
  - **Otvori postojeću**;
  - **Ipak je drugi zapis — spremi**, written to the audit log as „Potvrđeno: nije duplikat“ with the ids of the similar families only, no names, telephones or e-mails (BR-22);
  - **Nazad**.
  Records are never merged automatically.
- **Blocked:** the same child (name and date of birth) twice in the same family. The form refuses it, and the backend refuses it again (`save_child`; SQLite compares lower case, the form also ignores accents).

**Verified:**
- Vitest 343/343. The duplicate rules are tested with invented names:
  - the proposal's example in three spellings;
  - family name, telephone and e-mail;
  - a family never matches itself, and shares its own home telephone;
  - a child in the same or another family.
- cargo test 69/69: the backend refuses the same child twice in one family; saving the same record again, or another birth date, is fine.
- **Open:** the Director's check in the running app (C-13).

---

## DL-P032 — Saving a document always says what happened; no personal data in the export log

**Date:** 2026-11-27 · **Source:** Director, 2026-11-27 (screenshot of „Račun — PDF“): „Račun se ne može sačuvati, a save je bez bilo kakve obavijesti“.

**Cause:**
- The PDF preview showed the built-in viewer's own toolbar, whose save and print buttons do nothing inside the app and give no message.
- When the app's „Sačuvaj PDF“ save dialog was cancelled, nothing was said either.

**Decision:**
- The preview hides the viewer's toolbar (`#toolbar=0`). Only the app's „Štampaj“ and „Sačuvaj PDF“ remain.
- Every save (invoice PDF, remainder notice, ZIP of the month, register exports, import report) reports one of three outcomes: „Sačuvano: …“, an error, or „Spremanje otkazano — dokument nije sačuvan“.
- **BR-22:** the audit entry of a saved document held the full path, which contains the user's folders and a file name with the child's name. It now holds only the kind of document (e.g. „.pdf“). Older entries in the trial database keep their path.

**Verified:** Vitest 345/345, cargo test 70/70. **Open:** the Director's check (C-13).

---

## DL-P033 — A payment on a paid invoice, an overpayment or the same payment again: said and confirmed

**Date:** 2026-11-28 · **Trigger:** the Director paid 1.000 KM on IMH-897/26 (1.420 KM − KO 420 KM = 1.000 KM) and saw it as overpaid. The database held **two** payments of 1.000 KM with the same date and reference, entered 2 h 40 min apart. The second one was accepted without a word.

**Decision:**
- An overpayment stays possible: a parent can really pay twice, and the money must be booked. It becomes family credit (DL-P011). It is never recorded silently.
- **Fully paid invoice:** instead of the payment form, „Račun je plaćen u cijelosti“ with **Ipak evidentiraj uplatu…**.
- **Before saving**, the form shows each warning that applies (`paymentWarnings`, credit-notes.ts):
  - the invoice is already paid: the whole payment becomes credit;
  - the amount is above what is still open: the excess becomes credit;
  - a payment with the same amount (and the same date, or another date) is already on the invoice. Reversed payments do not count.
- While a warning is shown, **Evidentiraj uplatu** stays disabled until the operator ticks „Provjerio/la sam — ova uplata je stvarna i nije već unesena“. The tick resets when the warnings change.
- **The existing double payment** on IMH-897/26 is corrected by the operator with „Storno uplate“ on one of the two payments (S4). Nothing is deleted.

**Verified:** Vitest 346/346 (paymentWarnings: quiet for a normal or partial payment; paid invoice, overpayment, the same day, another day; a reversed payment does not count), cargo test 70/70, tsc, eslint, build. **Open:** the Director's check in the running app (C-13).

---

## DL-P034 — Saldo of the customer with a sign: negative = u pretplati

**Date:** 2026-11-28 · **Director:** „nema zaduženja a korisnik plati = u pretplati … moralo pisati -1.000 KM“.

**Decision:**
- The app shows the customer's balance as on a customer ledger card: **saldo = zaduženo − uplaćeno**.
  - Zaduženo means the invoices, reduced by their credit notes.
  - A positive saldo is **duguje**, a negative saldo is **u pretplati**, and 0 is **izmireno**.
  - Example, IMH-897/26: 1.000 KM charged, 2.000 KM paid, so the saldo is **−1.000,00 KM (u pretplati)**.
- The word „kredit“ is replaced by **pretplata** everywhere it was shown: status, invoice detail, step E, family card, transfer and refund panel, audit labels and payment warnings. The status OVERPAID is labelled „U pretplati“.
- **Invoice detail:** „Preostalo“ and „Kredit (višak uplate)“ are replaced by one line, **Saldo: …**.
- **Step E:** the column „Ostatak“ becomes **Saldo**, with a sign. A tile **U pretplati** shows the total prepayment as a negative amount when there is one.
- **Family card „Saldo porodice“:** zaduženo, uplaćeno and saldo per institution. IMH and IDSS are never mixed. Below them are the invoices that carry a prepayment.
- **Register export (XLSX):** the column „Ostatak (KM)“ becomes **Saldo (KM)**, signed.
- The stored data and the balance definition (NET_SQL / PAID_SQL, M-7) are unchanged. Only the display changes. „Otvoreno“ in the totals stays the sum of what is owed.
- **Not covered yet:** a payment with no invoice at all, e.g. a parent pays before anything is charged. Every payment is still booked on an invoice (payments.invoice_id NOT NULL). An advance on the family account needs its own SPEC and migration, approved by the Director.

**Verified:** Vitest 347/347 (saldo sign and labels, IMH-897/26 → −1.000,00 KM, per institution, credit-note documents not counted as charges), tsc, eslint, build. **Open:** the Director's check (C-13).

---

## DL-P035 — Child prepayment: payment without an invoice, excess as prepayment, payer from the wider family

**Date:** 2026-11-28 · **Spec:** `specs/family-advance/` (SPEC, PLAN and TASKS). The Director approved the SPEC, the PLAN and the amendment of BR-24, and decided Q1–Q6 one by one (C-6). Migration 016.

**Trigger:** the Director, 2026-11-28:
- „nema zaduženja a korisnik plati = u pretplati … moralo pisati −1.000 KM“;
- „predvidi uplatu koju izvrši neki drugi član obitelji (deda, baka, tetka i slično) za neko dijete“.

**Decision:**
- **Ledger card per child and institution (Q1).**
  - saldo = zaduženo − uplaćeno + vraćeno; a negative saldo means **u pretplati**. IMH and IDSS are never mixed.
  - The family's saldo is the sum of its children's.
  - The one definition is `prepayments::child_balances` (M-7); the screens only display it.
- **Payment without an invoice** („Evidentiraj uplatu bez računa (pretplata)…“ on the family card):
  - fields: institution, child (required), date, amount, payer, relation to the child, reference and purpose;
  - warnings, as in DL-P033: an unpaid invoice of the child, or the same payment again.
- **Payer** (BR-24 amended, Q6): every payment, on an invoice or not, records the payer's name and relation (baka, djed, tetka …), typed each time. The payer never becomes a guardian or the buyer.
- **Excess on an invoice is the child's prepayment (Q4; changes S3).**
  - The invoice is „Plaćen · višak u pretplati“; its saldo is 0.
  - The excess is computed, never copied, so IMH-897/26 needed no data change: its child is at −1.000,00 KM.
- **Using prepaid money (Q2): proposed, applied only on the operator's click.** It is offered in three places:
  - right after issuing one invoice, before its PDF;
  - in „Štampaj fakture“ of the monthly and the other billing, before the PDFs are sent;
  - in the invoice detail.

  The amount is at most the smaller of the child's prepayment and what is open. The oldest money is used first: payments without an invoice and invoice excess.
- **Transfer to a brother's or sister's invoice** needs an explicit transfer and a note (Q1).
- **Refund and storno:** a refund needs a note. Every use, every refund and every payment without an invoice can be reversed with a reason. Nothing is deleted or changed in place, and database triggers refuse it.
- **Invoice PDF (Q3; changes DL-P026 for prepayment only).**
  - The recapitulation shows „Iznos računa“, „Umanjeno za primljenu pretplatu: −X“, and UKUPNO ZA UPLATU after it. The slip, the QR, the amount in words, the DOCX and the mail summary use that amount.
  - When the prepayment covers the whole invoice, there is no slip and the PDF says „PLAĆENO IZ PRETPLATE — NE UPLAĆUJTE“.
  - Ordinary payments are still never printed. The remainder notice deducts the prepayment.
- **„Potvrda o uplati“ (Q5):** on request, for every payment. One A4 page on the letterhead, with the child's signed saldo on the day of the receipt, and no slip.
- **Reports:**
  - XLSX register: a sheet „Pretplate“ (children in prepayment, for the accountant, K1) and „U pretplati“ in the summary;
  - step E: the „U pretplati“ total now includes payments without an invoice.
- **Removed:**
  - the word „kredit“ everywhere;
  - the old credit panel of the invoice (move_credit stays in the backend for the records already made);
  - the frontend wrappers that nothing calls any more.

**Verified:**
- **cargo test 78/78**, including:
  - every refusal of SPEC §5;
  - oldest-first across both kinds of source;
  - reversals, and append-only also against direct SQL;
  - migration 016 on a database with an existing excess;
  - 40 random sequences of 30 operations, after each of which the fening identity holds for every card and no invoice has negative payments.
- **Vitest 352/352**: the warnings, the recapitulation, the slip and QR amounts, the paid-from-prepayment notice, one page, the receipt, and the sheet „Pretplate“.
- tsc, eslint and build pass.
- Sample PDFs (invented data) were checked visually.

**Open:**
- the Director's check in the running app (C-13);
- for the accountant: the account for prepayments (K1).
- **K2 closed (Director, 2026-11-28):** IMH and IDSS are not PDV payers, as the Director had already stated and the invoice note says. A prepayment needs no avansni račun and no PDV.


## DL-P036 — Director's C-13 check of DL-P035: payer relation, TRN line, the child's invoices on the family card

**Source:** Director, 2026-11-28, C-13 in the running app. He sent the receipt for IDSS-582/26 and the PDF of the cancelled IDSS-584/26, and asked: „ne mogu da nađem u app“, then „dodaj spisak računa. Operater mora se lagano i logično kretati kroz cijelu aplikaciju. Workflow je izuzetno važan.“

**Found (on a copy of the database, technical fields only):**
- The grandfather's 4.000 KM on IDSS-582/26 was recorded twice (02:52 and 14:34, same payer and reference). The second time the duplicate warning (DL-P033) was confirmed because the morning instruction said to tick it, without first checking that the payment was already recorded. The Director reversed the second payment, and the child's saldo is now 1.830,00 KM (duguje). That is correct: manual invoices 569, 573, 574 and 575 and the remainder on 581 are open.
- **Defect 1:** the relation field was filled with „roditelj / staratelj“ and kept it when another payer was typed. The browser list then also hid „djed“. Both payments were saved with the wrong relation.
- **Defect 2:** a cancelled invoice (0,00 KM to pay) still printed „Uplatu izvršiti na TRN …“.
- **Defect 3 (workflow):** a child's invoices could only be found in Izvještaji → Registar faktura. Step E shows one billing month only, and the family card had no invoices.

**Decided and done:**
- **Relation:** `relationForPayer`, one definition, used in both payment forms.
  - A parent from the record gets „roditelj / staratelj“.
  - Anyone else gets an empty, required field.
  - A relation the operator typed is kept.
- **TRN line:** printed only when the invoice carries a payment slip, i.e. something is left to pay (`hasPaymentSlip`). Credit notes, cancelled invoices and invoices paid from the prepayment never get it.
- **Family card:** „Saldo porodice“ now lists every child's invoices under its saldo, per institution.
  - Each invoice shows its number, month, amount, status, what is left, and its credit notes.
  - A click opens the invoice (payment, credit note, remainder notice), and „PDF“ shows it.
  - The list is open when something is unpaid, folded otherwise.
  - Pure helper `family-invoices.ts` (tested).
- Two old type errors in the tests, which broke `npm run build`, were fixed.

**Verified:**
- Vitest 358/358, tsc, eslint and build pass.
- The PDF of IDSS-584/26 no longer has the TRN line (checked by the Director's own export).

**Open:**
- the Director's check of the family card (C-13).

---

*Commander v1.8.1 — IDSS123a Organisation*
