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
- printed next to the words "PROBNI FORMAT — banka ga još nije potvrdila. Prije potvrde uplate provjerite primaoca, račun i iznos.";
- generated with `qrcode` 1.5.4 (MIT, pinned) and drawn as vector squares; verified by decoding the rendered PDF (OpenCV);
- replace by the bank's format as soon as it is known, then remove the "probni" label.

---

*Commander v1.6.2 — IDSS123a Organisation*
