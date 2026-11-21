# SPEC — One invoice per child with all its costs (F2b)

*FEATURE_LIFECYCLE · Commander v1.8.1 · Director 2026-11-21 · DL-P014 · amends `specs/manual-invoice` (F2) and CONSTITUTION BR-27*

## Purpose
- The parent receives **one invoice per child** carrying everything owed for that child that month: tuition plus the enrolment fee, materials and deposit when they fall due, and any extra service.
- The operator confirms every invoice and decides what it shows.
- A separate manual invoice exists only for a child who is **not regularly enrolled** and uses a service temporarily, e.g. summer school only.

## Rules
| # | Rule | Where |
|---|---|---|
| R1 | The monthly preview has one invoice per child and institution: tuition (IDSS: instalments due, breakfast) plus every one-time item of the enrolment not yet billed. | `monthly.ts familyPreview` |
| R2 | One-time items follow BR-9 / BR-10: no enrolment fee or new deposit for a continuing child or the transfer; materials every year; deposit by sibling tier; reduced IDSS fee after IDSS Preschoolers. | `enrolment-fees.ts` (unchanged rules) |
| R3 | Already billed = on an issued, not cancelled invoice of the same enrolment. The two enrolment-fee codes count as one. | Rust `ensure_one_time_not_billed`, `billed_one_time` |
| R4 | An imported invoice of the old workbook (no enrolment) issued from 1 March of the year before the school year, carrying the same item for the child, means the item is proposed **unticked**, with a note naming that invoice. | `oneTimeLines` |
| R5 | The IDSS deposit is proposed only with a tuition plan of 2+ instalments, and unticked (the school's decision). | `oneTimeLines` |
| R6 | The operator ticks lines off or leaves out a whole invoice. A one-time item left out is proposed again next month. An excluded IDSS instalment is not marked invoiced. | `finalDrafts` |
| R7 | The operator may add a service outside the price list (description, JM, quantity, price). The invoice then needs a basis. No price-list amount is ever edited (BR-7). | preview, Rust `validate_lines` |
| R8 | An IDSS pupil with no instalment due, but with unbilled one-time items, gets an invoice with those items. | `familyPreview` |
| R9 | „Račun za upis“ is removed; existing `ENROLMENT_FEES` invoices stay and count as billed. | UI |
| R10 | The manual invoice is only for a child with no enrolment in that institution and school year, other than withdrawn. Its lines have no enrolment and no program. Rust refuses it for an enrolled child. | `manual.ts`, Rust `ensure_not_enrolled` |
| R11 | Due date: the monthly one for the whole invoice. | `dueDateForMonth` |

## Acceptance Criteria
- [x] Vitest: R1–R8, R10; cargo: R3, R7, R10 (see DL-P014).
- [x] The Director checks a monthly preview in the running app, including a child starting this month, a line ticked off and an added service, and then a manual invoice for a non-enrolled child (C-13).
