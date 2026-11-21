# SPRINT 03 — Lessons

## L-S3-01 — Scope change mid-sprint: invoice per child, not per family
- **Trigger:** Director (2026-10-21): "kreiraju se zasebni računi u sistemu za svako dijete".
- **Fix:** `buildImhMonthlyInvoices` returns one draft per child; migration 004 (never edit 003) adds `invoices.child_id` and replaces the per-family unique index with a per-child one; Rust rejects lines of another child.
- **Lesson:** the invoice granularity (per family / per child) is a business rule — ask it explicitly before modelling invoices.
- **Env gotcha:** long bash heredocs with mixed quotes failed in the Windows Bash tool; write the script to the scratchpad and run it instead.

## L-S3-02 — Board-decided parameters are data, not assumptions
- **Trigger:** I assumed "last instalment by 31.08." and asked which months breakfast is billed. Director: both are decided by the board (UO/ŠO).
- **Fix:** removed the hard-coded deadline; `board_billing_rules` per school year and entity (migration 005), entered in Settings with the decision reference; breakfast opt-in per enrolment.
- **Lesson (M-4):** when a parameter belongs to a governing body, model it as a dated, referenced setting instead of asking for a value or assuming one.
- **Commander candidate:** add to M-4 — "policy parameters owned by a board are configuration with provenance, never constants".

## L-S3-03 — pdf-lib font subsetting drops glyphs (environment gotcha)
- **Trigger:** the first sample invoice rendered with most letters missing although the text layer was correct.
- **Cause:** `embedFont(..., { subset: true })` with @pdf-lib/fontkit 1.1.1 produced broken subsets of Noto Sans.
- **Fix:** pre-subset the font to Latin with fontTools (~24 KB) and embed it whole (DL-P007, `src/assets/fonts/README.md`).
- **Lesson:** a PDF test that only checks structure/metadata is not enough — render the page to an image and look at it before calling the PDF done.

## L-S3-04 — The new PDF dropped a feature the old app had (payment slip)
- **Trigger:** Director: "zašto nema uplatnice u donjoj polovini računa… zašto se ne prikazuje QR kod".
- **Cause:** the Sprint 03 PDF spec listed the invoice content but not the slip; the old app's slip was noted only in the forensic report. The QR was left out on purpose but never told to the Director.
- **Fix:** pre-filled slip with the open amount (DL-P008); QR held back until a BiH bank confirms the format.
- **Lesson:** when replacing an existing tool, list every user-visible feature of the old one and mark each kept / changed / dropped *with the Director* before building. A deliberate omission must be announced, not discovered.
- **Commander candidate:** "replacement parity checklist" in FEATURE_LIFECYCLE.

## L-S3-05 — Profiling a workbook with personal data: mask from the first query
- **Trigger:** while profiling the old invoice workbook, two exploratory queries printed real child and parent names into the session transcript (not into the repository, logs or commits).
- **Fix:** later queries printed only shapes, counts and masked values; temporary dumps were written to the scratchpad and deleted right after use; the staged diff was scanned for the names before committing.
- **Lesson (M-15):** when a file is known to hold personal data, the *first* query must already mask values (length + first letters) and print aggregates only. "Most common values" of a name column is personal data.
- **Commander candidate:** add to M-15 — "data profiling prints shapes and counts, never raw values of person columns".

## L-S3-06 — Legacy import merged two different invoices that share a number
- **Trigger:** forensic review (2026-11-21). The DB sheet rows were grouped by entity + number across the whole sheet, so a number reused for a different buyer further down was merged into the first invoice, billed to the first buyer and booked as fully paid, with no warning. The real workbook has two such numbers (IDSS 056/26, IDSS 363/26; 1.727,53 KM attributed to the wrong families).
- **Fix:** an invoice is a block of ADJACENT rows with the same number. A later block with the same number is absorbed only when it is an empty block of the same buyer and child; otherwise it is isolated (not imported, not renumbered) and listed in the preview with its Excel rows and amount. An amount typed as text is parsed (bs-BA or plain); an unreadable amount stops the import instead of becoming 0 KM.
- **Lesson:** a "key" in a legacy spreadsheet is a claim, not a guarantee. Before grouping by it, count how often it repeats in non-adjacent rows of the real file, and decide the duplicate rule with the Director. The previous HTML app already had this rule (isolate and report); replacement parity (L-S3-04) must cover data-integrity rules, not only visible features.
- **Commander candidate:** add to the import checklist — "measure key uniqueness on the real source before choosing a grouping key".

## L-S3-07 — The import resolved inconsistencies silently by defaulting
- **Trigger:** Director (2026-11-21): on go-live day every invoice is imported; the import must recognise and categorise every inconsistency precisely so it can be resolved afterwards.
- **Finding:** besides merging reused numbers (L-S3-06), the import silently replaced missing billing periods (16 invoices) and missing due dates (9) by the invoice date, booked invoices with „plaćeno“ on only some lines as fully paid (18), and rounded amounts with more than two decimals (3) — none of it visible.
- **Fix:** `diagnostics.ts` — 31 categories with a Director-confirmed severity (BLOCK / ISOLATE / REVIEW / INFO); every default, skip, isolation or rounding is exactly one finding; partly flagged invoices get a payment of the flagged lines (Q1); Excel report for the accountant (Q3). Spec: `specs/legacy-import-diagnostics/`.
- **Lesson:** a *default* is a decision. In an import of accounting data, every value the code fills in on its own must be reported like an error, or the books and the source silently diverge.
- **Env gotcha:** the agent's file-writing tool turned `\uXXXX` escape sequences into the literal characters (a no-break space inside a regex, a control-character range). Avoid `\u` escapes in source written by the agent; compare character codes instead, and let ESLint (no-irregular-whitespace) catch what slips through.
- **Commander candidate:** in the import checklist — "list every default the importer applies and report each one as a finding".
