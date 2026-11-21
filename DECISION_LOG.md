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

---

*Commander v1.8.1 — IDSS123a Organisation*
