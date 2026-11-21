# PLAN — Dashboard and audit-log viewer (F3)

*FEATURE_LIFECYCLE Step 2 · see SPEC.md*

No migration: the audit log and every needed table exist.

1. **Rust**
   - `families::enrolment_overview(conn, school_year)`: rows of `program, status, family_id, child_id`, no names. Command `list_enrolment_overview`.
   - `audit.rs`: `list_audit(conn, AuditFilter { from, to, category, search, limit, offset })`.
     - Newest first.
     - Names are resolved with LEFT JOINs: an invoice by its number; a payment through its invoice; a family by `display_name`; a child or enrolment by the child's name.
     - Search runs over action, details, id and the resolved name.
     - The category is a fixed list of entity kinds.
     - Command `list_audit_log`, read-only, using an index on `audit_log(at)`. The index would be a migration, so it is NOT added: 10.000 rows are scanned in milliseconds; measure it in a test.
   - cargo tests: name resolution incl. a deleted record, the filters, paging and ordering.
2. **TS repository + Zod** for both commands.
3. **Domain**
   - `dashboard/stats.ts`: `dashboardStats(invoices, enrolments, { entity, month, today })`. A pure function on `invoiceBalance`; property tests against the register sums.
   - `audit/labels.ts`: action and entity labels, plus a test that every action code in `src-tauri/src/*.rs` has a label. The test reads the Rust sources.
4. **UI**
   - `DashboardPage`: cards, the SVG bar, recent invoices opening `InvoiceDetailDialog` and `InvoicePdfDialog`, and the entity and month filters.
   - `AuditLogPage`: filters, table and „Učitaj još“.
   - `AppShell`: the menu items and the start page.
5. **Docs** DL-P016, matrix 3.1 and 3.15 ✅, SPRINT note.
