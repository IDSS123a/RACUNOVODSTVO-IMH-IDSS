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
];

/// Latest schema version this build understands.
pub fn latest_version() -> i64 {
    MIGRATIONS.last().map(|(version, _)| *version).unwrap_or(0)
}

pub fn current_version(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

/// Apply all pending migrations, each in its own transaction.
pub fn apply(conn: &mut Connection) -> AppResult<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let current = current_version(conn)?;
    if current > latest_version() {
        return Err(AppError::Conflict(format!(
            "baza je novije verzije ({current}) od aplikacije ({}) — instalirajte noviju verziju aplikacije",
            latest_version()
        )));
    }
    for (version, sql) in MIGRATIONS.iter().filter(|(version, _)| *version > current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
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
