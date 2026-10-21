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
