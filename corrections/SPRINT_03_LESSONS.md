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
