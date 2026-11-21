//! Numbered schema migrations (Commander A-6). Applied in order and tracked in
//! `PRAGMA user_version`. A migration is never edited after release — add a new one.

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// (version, SQL) — embedded at compile time from `src-tauri/migrations/`.
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../migrations/001_initial_schema.sql")),
    (2, include_str!("../migrations/002_families.sql")),
    (3, include_str!("../migrations/003_invoices.sql")),
    (4, include_str!("../migrations/004_invoice_per_child.sql")),
    (5, include_str!("../migrations/005_board_rules_breakfast.sql")),
    (6, include_str!("../migrations/006_institution_invoice_note.sql")),
    (7, include_str!("../migrations/007_enrolment_fee_guard.sql")),
    (8, include_str!("../migrations/008_legacy_import.sql")),
    (9, include_str!("../migrations/009_legacy_import_findings.sql")),
    (10, include_str!("../migrations/010_credit_notes.sql")),
    (11, include_str!("../migrations/011_credit_note_line_position.sql")),
];

/// Latest schema version this build understands.
pub fn latest_version() -> i64 {
    MIGRATIONS.last().map(|(version, _)| *version).unwrap_or(0)
}

pub fn current_version(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

/// Apply all pending migrations, each in its own transaction.
/// Foreign keys are OFF while migrating (SQLite's procedure for rebuilding a table, used by 008);
/// every migration must leave `PRAGMA foreign_key_check` empty, otherwise it is rolled back.
pub fn apply(conn: &mut Connection) -> AppResult<()> {
    let current = current_version(conn)?;
    if current > latest_version() {
        return Err(AppError::Conflict(format!(
            "baza je novije verzije ({current}) od aplikacije ({}) — instalirajte noviju verziju aplikacije",
            latest_version()
        )));
    }
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let result = apply_pending(conn, current);
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    result
}

fn apply_pending(conn: &mut Connection, current: i64) -> AppResult<()> {
    for (version, sql) in MIGRATIONS.iter().filter(|(version, _)| *version > current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        let violations: i64 = tx.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| row.get(0))?;
        if violations > 0 {
            return Err(AppError::Conflict(format!("migracija {version} bi narušila veze u bazi ({violations})")));
        }
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

/// Refuse to restore a backup that is not a database of this application.
pub fn validate_restorable(conn: &Connection) -> AppResult<()> {
    let version = current_version(conn)?;
    if version < 1 || version > latest_version() {
        return Err(AppError::Validation(format!("rezervna kopija ima nepoznatu verziju šeme ({version})")));
    }
    let has_core: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('legal_entities','price_list_items','audit_log')",
        [],
        |row| row.get(0),
    )?;
    if has_core != 3 {
        return Err(AppError::Validation("rezervna kopija nije baza ove aplikacije".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rebuild_008_keeps_data_links_and_guards() {
        let mut conn = Connection::open_in_memory().unwrap();
        for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 7) {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", version).unwrap();
        }
        conn.execute_batch(
            "INSERT INTO families(id, display_name, created_at) VALUES ('f', 'Test', 'x');
             INSERT INTO children(id, family_id, first_name, last_name, date_of_birth, residency, created_at)
               VALUES ('c', 'f', 'A', 'T', '2021-01-01', 'DOMESTIC', 'x');
             INSERT INTO enrolments(id, child_id, program, school_year, starts_on, status, created_at)
               VALUES ('e', 'c', 'TODDLERS', '2026/2027', '2026-09-01', 'ACTIVE', 'x');
             INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, issue_date, due_date,
                                  period_from, period_to, total_fenings, status, created_at)
               VALUES ('i', 'IMH-001/26', 'IMH', 'MONTHLY', 'f', 'c', 'B', '2026-10-01', '2026-10-05',
                       '2026-10-01', '2026-10-31', 71000, 'ISSUED', 'x');
             INSERT INTO invoice_lines(id, invoice_id, position, item_code, description, child_id, enrolment_id, program,
                                       list_amount, amount)
               VALUES ('l', 'i', 1, 'TUITION', 'S', 'c', 'e', 'TODDLERS', 71000, 71000);
             INSERT INTO payments(id, invoice_id, paid_on, amount, payer_name, created_at) VALUES ('p', 'i', '2026-10-02', 100, 'B', 'x');",
        )
        .unwrap();
        apply(&mut conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        let kept: (String, i64, String) = conn
            .query_row(
                "SELECT c.date_of_birth, i.total_fenings, i.source FROM invoices i JOIN children c ON c.id = i.child_id",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(kept, ("2021-01-01".to_string(), 71000, "APP".to_string()));
        let fk: bool = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert!(fk, "foreign keys must be back on");
        // links and guards still hold after the rebuild
        assert!(conn.execute("DELETE FROM children WHERE id = 'c'", []).is_err());
        assert!(conn
            .execute(
                "INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, issue_date, due_date,
                                      period_from, period_to, total_fenings, status, created_at)
                 VALUES ('i2', 'IMH-002/26', 'IMH', 'MONTHLY', 'f', 'c', 'B', '2026-10-01', '2026-10-05',
                         '2026-10-01', '2026-10-31', 1, 'ISSUED', 'x')",
                [],
            )
            .is_err());
        assert!(conn
            .execute(
                "INSERT INTO invoices(id, number, entity, kind, family_id, buyer_name, issue_date, due_date,
                                      period_from, period_to, total_fenings, status, created_at)
                 VALUES ('i3', 'IMH-003/26', 'IMH', 'OTHER', 'f', 'B', '2026-10-01', '2026-10-05', '2026-10-01', '2026-10-31', -5, 'ISSUED', 'x')",
                [],
            )
            .is_err(), "negative totals only for imported invoices");
        conn.execute(
            "INSERT INTO invoices(id, number, entity, kind, family_id, buyer_name, issue_date, due_date,
                                  period_from, period_to, total_fenings, status, created_at, source)
             VALUES ('k', 'IDSS KO-33/26', 'IDSS', 'CREDIT_NOTE', 'f', 'B', '2026-10-01', '2026-10-01', '2026-10-01', '2026-10-31', -12500, 'ISSUED', 'x', 'LEGACY')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO children(id, family_id, first_name, last_name, residency, created_at, import_review) VALUES ('c2', 'f', 'B', 'T', 'DOMESTIC', 'x', 1)", [])
            .unwrap();
    }

    /// E-19: migration 010 rebuilds `invoices` under existing data of every kind (app and legacy invoices,
    /// credit notes, payments, plan items, import findings) and must keep all of it and all links.
    #[test]
    fn rebuild_010_keeps_every_invoice_payment_and_link() {
        let mut conn = Connection::open_in_memory().unwrap();
        for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 9) {
            let tx = conn.transaction().unwrap();
            tx.execute_batch(sql).unwrap();
            tx.pragma_update(None, "user_version", version).unwrap();
            tx.commit().unwrap();
        }
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             INSERT INTO families(id, display_name, created_at) VALUES ('f', 'Test', 'x');
             INSERT INTO children(id, family_id, first_name, last_name, date_of_birth, residency, created_at)
               VALUES ('c', 'f', 'A', 'T', '2016-01-01', 'DOMESTIC', 'x');
             INSERT INTO enrolments(id, child_id, program, school_year, starts_on, status, created_at)
               VALUES ('e', 'c', 'PRIMARY_1_4', '2026/2027', '2026-09-01', 'ACTIVE', 'x');
             INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, issue_date, due_date,
                                  period_from, period_to, total_fenings, status, created_at)
               VALUES ('a', 'IDSS-569/26', 'IDSS', 'MONTHLY', 'f', 'c', 'B', '2026-10-01', '2026-10-05',
                       '2026-10-01', '2026-10-31', 80833, 'ISSUED', 'x');
             INSERT INTO invoice_lines(id, invoice_id, position, item_code, description, child_id, enrolment_id, program, list_amount, amount)
               VALUES ('a-1', 'a', 1, 'TUITION', 'S', 'c', 'e', 'PRIMARY_1_4', 80833, 80833);
             INSERT INTO payments(id, invoice_id, paid_on, amount, payer_name, created_at) VALUES ('p', 'a', '2026-10-02', 50000, 'B', 'x');
             INSERT INTO payment_plans(id, enrolment_id, item_code, instalments, total, created_at) VALUES ('pl', 'e', 'TUITION', 1, 80833, 'x');
             INSERT INTO payment_plan_items(plan_id, sequence, due_date, amount, invoice_id) VALUES ('pl', 1, '2026-10-05', 80833, 'a');
             INSERT INTO invoices(id, number, entity, kind, family_id, buyer_name, issue_date, due_date, period_from, period_to,
                                  total_fenings, status, created_at, source)
               VALUES ('l', 'IDSS 363/26', 'IDSS', 'OTHER', 'f', 'B', '2026-07-01', '2026-07-01', '2026-07-01', '2026-07-31', 91919, 'ISSUED', 'x', 'LEGACY'),
                      ('k33', 'IDSS KO-33/26', 'IDSS', 'CREDIT_NOTE', 'f', 'B', '2026-08-01', '2026-08-01', '2026-08-01', '2026-08-31', -25000, 'ISSUED', 'x', 'LEGACY'),
                      ('k35', 'IDSS KO-35/26', 'IDSS', 'CREDIT_NOTE', 'f', 'B', '2026-09-01', '2026-09-01', '2026-09-01', '2026-09-30', -91916, 'ISSUED', 'x', 'LEGACY');
             INSERT INTO legacy_import_findings(id, finding_key, category, severity, entity, number, invoice_id, excel_rows, reason,
                                                first_seen_at, last_seen_at, last_seen_file)
               VALUES ('g', 'CREDIT_NOTE_UNLINKED|IDSS|KO-35/26', 'CREDIT_NOTE_UNLINKED', 'REVIEW', 'IDSS', 'KO-35/26', 'k35', 'DB 9', 'r', 'x', 'x', 'f');",
        )
        .unwrap();
        let before: (i64, i64, i64) = conn
            .query_row("SELECT count(*), sum(total_fenings), (SELECT sum(amount) FROM payments) FROM invoices", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();

        apply(&mut conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        let after: (i64, i64, i64) = conn
            .query_row("SELECT count(*), sum(total_fenings), (SELECT sum(amount) FROM payments) FROM invoices", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(after, before, "no invoice, amount or payment lost");
        let violations: i64 = conn.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
        assert_eq!(violations, 0);
        let fk: bool = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert!(fk, "foreign keys must be back on");
        let seq: i64 = conn
            .query_row("SELECT last_number FROM credit_note_sequences WHERE entity = 'IDSS' AND year = 2026", [], |r| r.get(0))
            .unwrap();
        assert_eq!(seq, 35, "the credit-note series continues after the imported KO-35/26 (S1)");
        // links still hold
        assert!(conn.execute("DELETE FROM invoices WHERE id = 'a'", []).is_err(), "payments, lines and plan items still point to it");
        assert!(conn.execute("DELETE FROM invoices WHERE id = 'k35'", []).is_err(), "the finding still points to it");
        // the new guards
        let credit_note = |id: &str, credits: Option<&str>, total: i64, reason: &str| {
            conn.execute(
                "INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, issue_date, due_date, period_from, period_to,
                                      total_fenings, status, created_at, credits_invoice_id, reason)
                 VALUES (?1, ?1, 'IDSS', 'CREDIT_NOTE', 'f', 'c', 'B', '2026-11-01', '2026-11-01', '2026-10-01', '2026-10-31', ?2, 'ISSUED', 'x', ?3, ?4)",
                rusqlite::params![id, total, credits, reason],
            )
        };
        assert!(credit_note("n1", None, -100, "razlog").is_err(), "an app credit note must point to its invoice");
        assert!(credit_note("n2", Some("a"), -100, " ").is_err(), "an app credit note needs a reason");
        assert!(credit_note("n3", Some("a"), 100, "razlog").is_err(), "a credit note is negative");
        credit_note("IDSS-KO-036/26", Some("a"), -30833, "pogrešan iznos").unwrap();
        assert!(conn
            .execute(
                "INSERT INTO invoices(id, number, entity, kind, family_id, buyer_name, issue_date, due_date, period_from, period_to,
                                      total_fenings, status, created_at, credits_invoice_id)
                 VALUES ('x', 'IDSS-570/26', 'IDSS', 'OTHER', 'f', 'B', '2026-11-01', '2026-11-01', '2026-11-01', '2026-11-30', 100, 'ISSUED', 'x', 'a')",
                [],
            )
            .is_err(), "only a credit note may point to another invoice");
        conn.execute("INSERT INTO payment_reversals(id, payment_id, reversed_on, reason, created_at) VALUES ('r', 'p', '2026-11-02', 'pogrešan račun', 'x')", [])
            .unwrap();
        assert!(conn
            .execute("INSERT INTO payment_reversals(id, payment_id, reversed_on, reason, created_at) VALUES ('r2', 'p', '2026-11-02', 'opet', 'x')", [])
            .is_err(), "a payment is reversed at most once");
        assert!(conn
            .execute("INSERT INTO credit_movements(id, from_invoice_id, amount, moved_on, note, created_at) VALUES ('m', 'a', 0, '2026-11-02', 'n', 'x')", [])
            .is_err(), "a movement moves money");
    }

    /// L-S3-11: a database that applied 010 before the credit-note line position was split into 011
    /// (the trial database on the developer PC) gets the column from 011, and the invoice detail works.
    #[test]
    fn a_database_at_010_gets_the_credit_note_line_position_from_011() {
        let mut conn = Connection::open_in_memory().unwrap();
        for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 10) {
            let tx = conn.transaction().unwrap();
            tx.execute_batch(sql).unwrap();
            tx.pragma_update(None, "user_version", version).unwrap();
            tx.commit().unwrap();
        }
        let has_column = |conn: &Connection| -> bool {
            conn.query_row("SELECT count(*) FROM pragma_table_info('invoice_lines') WHERE name = 'credits_position'", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap()
                == 1
        };
        assert!(!has_column(&conn), "the state of the trial database before the fix");
        conn.execute_batch(
            "INSERT INTO families(id, display_name, created_at) VALUES ('f', 'T', 'x');
             INSERT INTO invoices(id, number, entity, kind, family_id, buyer_name, issue_date, due_date, period_from, period_to,
                                  total_fenings, status, created_at)
               VALUES ('i', 'IMH-001/26', 'IMH', 'OTHER', 'f', 'B', '2026-10-01', '2026-10-05', '2026-10-01', '2026-10-31', 100, 'ISSUED', 'x');",
        )
        .unwrap();
        assert!(crate::invoices::get_invoice(&conn, "i").is_err(), "the invoice detail failed exactly like on the trial database");
        apply(&mut conn).unwrap();
        assert!(has_column(&conn));
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        assert!(crate::invoices::get_invoice(&conn, "i").unwrap().is_some(), "the invoice detail works after 011");
    }

    #[test]
    fn applies_once_and_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply(&mut conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        apply(&mut conn).unwrap();
        validate_restorable(&conn).unwrap();
    }

    #[test]
    fn constraints_reject_bad_amounts_and_programs() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply(&mut conn).unwrap();
        let negative = conn.execute(
            "INSERT INTO price_list_items(school_year, program, item, residency, tier, basis, amount_fenings, source)
             VALUES ('2026/2027','TODDLERS','TUITION','DOMESTIC','FIRST','MONTHLY',-1,'x')",
            [],
        );
        assert!(negative.is_err());
        let unknown_program = conn.execute(
            "INSERT INTO price_list_items(school_year, program, item, residency, tier, basis, amount_fenings, source)
             VALUES ('2026/2027','NURSERY','TUITION','DOMESTIC','FIRST','MONTHLY',1,'x')",
            [],
        );
        assert!(unknown_program.is_err());
    }

    #[test]
    fn rejects_foreign_database() {
        let conn = Connection::open_in_memory().unwrap();
        assert!(validate_restorable(&conn).is_err());
    }
}
