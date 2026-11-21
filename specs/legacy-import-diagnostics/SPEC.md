# SPEC — Legacy import diagnostics

*FEATURE_LIFECYCLE Step 1 · Commander v1.6.2 · Status: DRAFT — open questions below must be answered by the Director before PLAN.md*
*Extends BR-32 (legacy invoice import). Source of the requirement: Director, 2026-11-21.*

## Purpose
On go-live day every invoice issued so far in the old Excel solution is imported, so the operator continues in the new
application without a break. All data in the application until then is test data.

The old workbook is hand-maintained. It contains errors and inconsistencies, and more will exist on go-live day than
today. They cannot all be fixed before the import. They must be fixed **after** it, one by one, together with the
accountant. That is only possible if the import:
- finds **every** inconsistency, not only the ones that stop it;
- puts each one into a **precise, named category** with a clear meaning and a severity;
- tells exactly **where** it is (entity, invoice number, Excel rows);
- never hides one by silently "fixing" it (E-5, M-4) — today some are swallowed (see Evidence).

## User Stories
- As the **operator**, before I import, I see every problem the workbook has, grouped by category with counts, so I know what I am importing and can stop to fix the workbook first if needed.
- As the **operator**, after the import, I can find every imported invoice that needs checking, by category, and mark it resolved when it is checked, so nothing is forgotten.
- As the **Director / accountant**, I receive the full list of problems as a file, so the corrections can be agreed and the imported totals reconciled with the workbook.

## Categories (31; measured on the example workbook, 2026-11-21: 1.569 invoices, 4.628 rows — 251 findings)
Severity: **BLOCK** — the workbook is not imported until fixed · **ISOLATE** — this record is not imported, the rest is · **REVIEW** — imported, marked for checking · **INFO** — imported, listed only. Severities confirmed by the Director (Q2); categories 8, 9 and 15 follow the same principle (not importable → ISOLATE, a silent default → REVIEW).

| # | Category | Meaning | Example workbook | Severity |
|---|---|---|---|---|
| 1 | Unreadable amount | an amount cell is text that is not a number | 0 | BLOCK |
| 2 | Unknown entity | entity is neither IMH nor IDSS | 0 | BLOCK |
| 3 | Line without invoice number | a line with content but no number | 0 | BLOCK |
| 4 | Number reused for another buyer or child | same number, separate block, different buyer/child | 2 | ISOLATE |
| 5 | Number reused by the same buyer, with money | second separate block of the same buyer with an amount | 0 | ISOLATE |
| 6 | Invoice without buyer | no father and no mother | 0 | ISOLATE |
| 7 | Invalid invoice date | missing or impossible date | 0 | ISOLATE |
| 8 | Invoice without lines | every row of the invoice is empty | 0 | ISOLATE |
| 9 | Register row without parents | a child in „Setting“ with no father or mother | 0 | ISOLATE |
| 10 | Invalid due date | missing or impossible due date (invoice date used) | 24 | REVIEW |
| 11 | Invalid period | period missing (invoice date used) or end before start | 17 | REVIEW |
| 12 | Number year ≠ invoice-date year | e.g. …/25 dated in 2026 | 1 | REVIEW |
| 13 | Invoice date after the import day | dated in the future | 0 | REVIEW |
| 14 | Paid flag on some lines only | „plaćeno“ on part of the lines → payment of the flagged lines (Q1) | 18 | REVIEW |
| 15 | Unknown payment status | status text other than „plaćeno“ or empty → imported unpaid | 0 | REVIEW |
| 16 | Line amount ≠ quantity × price − discount | differs by more than 0,01; imported as written | 0 | REVIEW |
| 17 | Discount outside 0–100 % |  | 0 | REVIEW |
| 18 | Amount with more than 2 decimals | rounded to fenings on import | 3 | REVIEW |
| 19 | Credit note without link to the original | KO-… cannot be tied to the invoice it cancels | 3 | REVIEW |
| 20 | Inconsistent credit note | positive total or „plaćeno“ on a credit note | 0 | REVIEW |
| 21 | Zero-total invoice |  | 0 | REVIEW |
| 22 | Invoice without child |  | 17 | REVIEW |
| 23 | Family not in register | buyer pair not in sheet „Setting“ | 2 | REVIEW |
| 24 | Child not in register | child not listed under these parents in „Setting“ | 1 | REVIEW |
| 25 | Same child name in two families | register lists one child name under two parent pairs | 3 | REVIEW |
| 26 | Lines disagree on header | lines of one invoice differ in buyer, child or dates | 0 | REVIEW |
| 27 | Empty repeated block | same number, same buyer, no money — absorbed | 2 | INFO |
| 28 | Negative line on a normal invoice |  | 34 | INFO |
| 29 | Unrecognised item text | imported as „Ostalo“ (invoices; 39 lines) | 20 | INFO |
| 30 | Gaps in numbering | per entity and year (IMH/26: 1 · IDSS/23: 434 numbers) | 2 | INFO |
| 31 | "-B" series | IMH number with -B (Director: ordinary IMH invoice) | 102 | INFO |

## Acceptance Criteria
- [ ] Every category above is detected; a test with a constructed workbook proves each one, including its count and Excel rows.
- [ ] No problem is ever resolved silently: every skipped, adjusted, isolated or rounded value appears in exactly one category.
- [ ] The preview shows counts per category and severity; every entry shows entity, invoice number and Excel rows.
- [ ] BLOCK prevents the import; ISOLATE removes only the affected invoices; REVIEW and INFO never change any number or amount (BR-32: nothing is recalculated).
- [ ] After the import, every REVIEW invoice is findable in the application by category, and the operator can mark it resolved; the mark and who/when is written to the audit log (BR-30).
- [ ] The full list can be saved as a file for the accountant. *(format: open question Q3)*
- [ ] Re-importing the newer workbook on go-live day reports the categories again for the whole workbook and does not duplicate or lose earlier review marks.
- [ ] The example workbook, re-run after the feature, reproduces the counts in the table above (± the Q1 decision).
- [ ] No personal data in logs, commits, test fixtures or file names (BR-22, M-15); the file for the accountant is saved only where the operator chooses.

## Explicitly Out of Scope
- Correcting data inside the application during the import (corrections are made in Excel before, or on the invoice after the import).
- Checking imported amounts against the price lists (imported invoices keep their amounts — BR-32).
- Linking credit notes to originals automatically (only reported, category 18) — part of the storno feature.
- Storno, payment reversal and dunning (Sprint 04).

## Decisions (Director, 2026-11-21 — asked one at a time, C-6)
- **Q1 → decided.** Category 13 (paid flag on some lines only): book **one payment of the sum of the flagged lines** (on the due date, noted as taken from Excel) and mark the invoice **REVIEW**.
- **Q2 → decided.** The proposed severities in the table are **confirmed** (the *(proposal)* marks no longer apply).
- **Q3 → decided.** The file for the accountant is an **Excel workbook**: one summary sheet and one sheet per category.
- **Q4 → decided.** REVIEW invoices are resolved **gradually while the operator works**; go-live does not wait for them. The number of unresolved ones stays visible.

## Open Questions
- none for SPEC. Technical constraints are recorded in PLAN.md.

## Evidence
Measured 2026-11-21 on the example workbook with counts only (L-S3-05). Before this feature the import swallowed partial paid flags, rounding, missing periods (16) and missing due dates (9) silently, merged reused numbers, and reported the rest only as free-text warnings.
