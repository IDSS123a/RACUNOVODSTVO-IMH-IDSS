# SPRINT 03 — Lessons

## L-S3-01 — Scope change mid-sprint: invoice per child, not per family
- **Trigger:** Director (2026-10-21): "kreiraju se zasebni računi u sistemu za svako dijete".
- **Fix:** `buildImhMonthlyInvoices` returns one draft per child; migration 004 (never edit 003) adds `invoices.child_id` and replaces the per-family unique index with a per-child one; Rust rejects lines of another child.
- **Lesson:** the invoice granularity (per family / per child) is a business rule — ask it explicitly before modelling invoices.
- **Env gotcha:** long bash heredocs with mixed quotes failed in the Windows Bash tool; write the script to the scratchpad and run it instead.
