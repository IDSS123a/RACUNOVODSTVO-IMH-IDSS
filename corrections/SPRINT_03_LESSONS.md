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

## L-S3-08 — The real-data end-to-end check exists; extend it with every new import step
- **Trigger:** phase B of the import diagnostics (2026-11-21).
- **Finding:** the ignored Rust tests `reads_real_workbook_shape` and `imports_real_plan_in_memory` already give a full real-data path (Rust reader → TypeScript plan → Rust import), but the second one did not store findings, so phase B would not have been covered.
- **Fix:** the test now stores the findings and prints stored / linked / open counts; run with `LEGACY_XLSM`, `LEGACY_JSON_OUT`, `LEGACY_PLAN` pointing into a scratch folder that is deleted afterwards (M-15).
- **Env gotcha:** the frontend targets ES2020 — `Object.hasOwn` does not type-check; use `Object.prototype.hasOwnProperty.call`.
- **Lesson:** a new persistence step of the import belongs in the real-data end-to-end test the same day, not only in unit tests.

## L-S3-09 — A negative test must never touch the working tree through git
- **Trigger:** while proving that the new store tests fail against the old write order, I put `git stash push` into the same command as the test run. That silently reverted `store.rs` to the committed version in the middle of the work. It was restored at once with `git stash pop`, and nothing was lost.
- **Fix:** the proof was redone without git. The file was copied to the scratch folder, the old order was applied, the tests were run and failed as expected, and the copy was put back. A hash check confirmed the restored file was identical.
- **Lesson (M-23 spirit):** commands that change the working tree or git state (stash, checkout, reset) are never chained into test or inspection commands. A "run the new test against the old code" check uses a file copy plus a hash check, never git.
- **Also:** `tauri dev` watches `src-tauri` and rebuilds and restarts the running app on every source change, including temporary ones. Stop it before experimenting with the Rust code.

## L-S3-10 — E-17 again: a regex written through a shell heredoc lost its backslashes
- **Trigger:** `/^KO-?(\d+)\/(\d{2})$/` became `/^KO-?(d+)/(d{2})$/` when a Node script in a bash heredoc inserted it. This is the third time escapes were corrupted in this sprint (L-S3-07: no-break space; the `dijete:` regex).
- **Fix:** the line was corrected with the file-edit tool; tsc caught it at once.
- **Lesson (E-17 recurrence):** code containing a regex or any backslash is inserted ONLY with the file-edit / file-write tools, never through a shell heredoc or a `node -e` string, even when the surrounding change is scripted.

## L-S3-11 — A migration was edited after the running dev app had applied it
- **Trigger:** Director (2026-11-21), screenshot: opening any invoice showed „Greška u bazi podataka“.
- **Cause:**
  - `tauri dev` watches `src-tauri` and rebuilt and restarted the app as soon as migration 010 was first written, so the trial database applied that first version and moved to version 10.
  - I then added `invoice_lines.credits_position` **to the same migration 010**.
  - The trial database never ran the addition, and the invoice detail query, which reads the column, failed.
  - Unit tests could not see it, because they always start from an empty database.
- **Fix:**
  - 010 is restored to exactly the content the trial database applied.
  - The column moved to a new migration 011, so fresh and existing databases both get it once.
  - A test builds a database at the old 010, reproduces the failing invoice detail, applies 011 and opens the invoice.
- **Lesson (A-6 / M-23 spirit):** a migration is frozen the moment ANY database has applied it, the developer's trial database included. While `tauri dev` runs, that moment is the first save. Every later schema change is a new migration.
- **Commander candidate:** in CLAUDE_CODE_OPERATIONS — "with a dev server that auto-rebuilds, treat a saved migration as released; stop the dev server before drafting migrations".

## L-S3-12 — Viewing the rendered PDF found two defects the tests passed over
- **Trigger:** F1. Rendering the samples and viewing them showed problems that no test had caught:
  - the barcode overlapped the long title „KNJIŽNO ODOBRENJE br. IDSS-KO-036/26“;
  - a credit note moved its signatures to an empty second page, because the space kept for the slip was reserved even though credit notes have no slip;
  - the registration number was printed twice („Reg. br: Reg. broj …“).
- **Fix:**
  - the barcode uses only the free space beside the title, or its own row;
  - the bottom reservation depends on what the document actually prints;
  - the registration number is printed as stored.
  - A page-count test now covers the credit note.
- **Lesson (L-S3-03 again):** every layout change is checked by rendering and LOOKING at each document type (one line, many lines, credit note, cancelled) before it is declared done.

## L-S3-13 — The invoice document mixed in the register's state
- **Trigger:** F2 check by the Director (2026-11-21).
  - An invoice of 710,00 with a 705,00 credit note printed „UKUPNO ZA UPLATU 710,00“, with the reduction only in a small line below.
  - The same PDF printed „Uplaćeno 5,00 · preostalo 0,00“, and its slip showed „plaćeno“, although the parent pays only after receiving the invoice.
  - The tests checked page counts and arithmetic, not what the document asks the parent to pay.
- **Fix:**
  - UKUPNO ZA UPLATU, the amount in words, the slip and the QR all state one figure (`amountDue` / `slipAmount`): the invoice after its credit notes.
  - Payments are never printed on the invoice (DL-P013 amendments 1 and 2).
- **Lesson:** an invoice is a document the parent acts on. Every printed amount must answer „how much do I pay on this invoice“. Payment state belongs to the register, never to the document. When a feature adds a state that changes an invoice's balance (credit notes, payments), render an invoice in that state and read it as the parent would.

## L-S3-14 — A silent empty preview hid a go-live blocker
- **Trigger:** the Director's check of one invoice per child (2026-11-21). The December preview said only „nema računa za izdavanje“.
  - The cause: the legacy import creates families, children and invoices, but no enrolments. The old sheet `Setting` has no program and no date of birth, so monthly billing had no one to bill.
  - The tests built families WITH enrolments, so none of them ever met an imported family.
- **Fix:**
  - the preview lists every child without an enrolment (and how many were imported);
  - „Upis djece bez upisa“ enrols them in one transaction, never guessing the program or the date of birth.
- **Lesson (E-5 again):** a bulk action must explain every record it does not act on, never only „nothing to do“. Test every bulk flow on data in the shape the legacy import produces, not only on data the app creates.
