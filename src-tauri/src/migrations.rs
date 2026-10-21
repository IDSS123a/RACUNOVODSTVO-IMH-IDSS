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
