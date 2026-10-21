# SPRINT 02 — Families, children, enrolments + Windows installer

**Status:** IN PROGRESS · **Mode:** FULL · **Commander:** v1.6.2
**Depends on:** Sprint 01 (encrypted storage, pricing engine, price lists)

---

## Goal

The operator can record every family on her own computer:
- the parents (guardians), including who pays and the bank account for subsidy refunds;
- the children, with their date of birth and BiH/foreign status;
- the enrolments: program, school year, start date and status.

For every family the app shows **which child pays the full price and which pays the discounted price**. This uses the Sprint 01 pricing engine, per legal entity, with the discount on the younger child.

The app is delivered as a **Windows installer** for the operator's computer (CONSTITUTION §1 Deployment).

## Why this order (M-2, M-8)

Invoices (Sprint 03) need correct families, children and enrolments first. Without them, nothing can be billed correctly. Splitting invoices into their own sprint keeps each iteration small and verifiable.

## IN scope
1. **Migration 002:**
   - `guardians` (family, full name, role, email, phone, address, IBAN for refunds, payer flag);
   - children get eligibility facts for the ministry subsidy: BiH citizen, residence in KS (Program 16/26);
   - the family gets an address.
2. **Domain (pure TS, tested):**
   - family validation: exactly one payer; IBAN format BA + check digits;
   - enrolment rules:
     - one active enrolment per child per legal entity and school year;
     - start date within the school year;
     - the program decides the legal entity (BR-1);
   - status transitions: `AWAITING_ENROLMENT_PAYMENT → ACTIVE → WITHDRAWAL_NOTIFIED → WITHDRAWN`, plus `SUSPENDED` and `COMPLETED`;
   - **family pricing summary:** per school year, each active enrolment with its sibling tier and monthly (IMH) / annual (IDSS) tuition from the price list.
3. **Tauri commands + repository** (A-3), all writes audited, with round-trip tests (E-14).
4. **UI:**
   - families list (search, empty state);
   - family detail with guardians, children and enrolments;
   - forms with RHF + Zod;
   - pricing summary card ("ko plaća puni iznos, ko umanjeni");
   - delete is blocked when dependent records exist (A-10).
5. **Installer:** `npm run tauri build` → MSI / NSIS. Install guide for the operator's computer (Bosnian, one page):
   - first run;
   - printing the recovery key;
   - choosing the backup folder.

## OUT of scope (later sprints)
- Invoices, invoice numbering, PDF, payment plans, payments, reminders (Sprint 03).
- Ministry subsidy cycle and refunds (Sprint 04).
- Withdrawal refund rules (Sprint 04).
- Import of legacy data (Sprint 05).

## Acceptance criteria
- [ ] A family with 3 children (2 in IMH, 1 in IDSS) shows:
  - IMH older = 710, IMH younger = 570/600 (by program);
  - IDSS = full annual tuition (no cross-entity discount).
- [ ] Two active enrolments of one child in the same entity and year are rejected by the domain and by a database constraint.
- [ ] Exactly one payer per family is enforced. IBANs are validated (mod-97).
- [ ] Round-trip tests for guardians, children and enrolments.
- [ ] The installer builds. Installing it on a clean Windows account opens the first-run flow.
- [ ] Director's walkthrough approved.

## Director decisions needed this sprint
- None for families. The invoice-related questions (numbering, invoice recipient) are asked at the start of Sprint 03.

---

HANDOFF NOTE — Sprint 02
Completed: —
Not completed: —
Open risks: —
Technical debt: —
Next sprint: Sprint 03 — invoices (IMH monthly, IDSS payment plans), numbering, PDF, payments, reminders
