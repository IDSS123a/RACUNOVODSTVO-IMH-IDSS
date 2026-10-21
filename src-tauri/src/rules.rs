//! Billing parameters decided by the board per school year, and the breakfast opt-in (Commander A-3).
//! The app never assumes these values: until the operator enters a decision, nothing is enforced or billed.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::repository::now;

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardBillingRules {
    pub school_year: String,
    pub entity: String,
    pub last_instalment_by: Option<String>,
    /// Calendar months 1–12 in which breakfast is billed; empty = not decided.
    pub breakfast_months: Vec<u32>,
    pub decision_ref: String,
}

fn parse_months(text: &str) -> Vec<u32> {
    text.split(',').filter_map(|m| m.trim().parse().ok()).collect()
}

pub fn list_rules(conn: &Connection, school_year: &str) -> AppResult<Vec<BoardBillingRules>> {
    let mut stmt = conn.prepare(
        "SELECT school_year, entity, last_instalment_by, breakfast_months, decision_ref
         FROM board_billing_rules WHERE school_year = ?1 ORDER BY entity",
    )?;
    let rows = stmt.query_map(params![school_year], |r| {
        Ok(BoardBillingRules {
            school_year: r.get(0)?,
            entity: r.get(1)?,
            last_instalment_by: r.get(2)?,
            breakfast_months: parse_months(&r.get::<_, String>(3)?),
            decision_ref: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn rules_for(conn: &Connection, school_year: &str, entity: &str) -> AppResult<Option<BoardBillingRules>> {
    Ok(list_rules(conn, school_year)?.into_iter().find(|r| r.entity == entity))
}

pub fn save_rules(tx: &Transaction, rules: &BoardBillingRules) -> AppResult<()> {
    if rules.decision_ref.trim().is_empty() {
        return Err(AppError::Validation("unesite broj i datum odluke odbora".into()));
    }
    let mut months = rules.breakfast_months.clone();
    months.sort_unstable();
    months.dedup();
    if months.len() != rules.breakfast_months.len() || months.iter().any(|m| !(1..=12).contains(m)) {
        return Err(AppError::Validation("mjeseci za doručak moraju biti različiti, od 1 do 12".into()));
    }
    let text = rules.breakfast_months.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    tx.execute(
        "INSERT INTO board_billing_rules(school_year, entity, last_instalment_by, breakfast_months, decision_ref, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(school_year, entity) DO UPDATE SET last_instalment_by = excluded.last_instalment_by,
           breakfast_months = excluded.breakfast_months, decision_ref = excluded.decision_ref, updated_at = excluded.updated_at",
        params![rules.school_year, rules.entity, rules.last_instalment_by, text, rules.decision_ref.trim(), now()],
    )
    .map_err(|e| match &e {
        rusqlite::Error::SqliteFailure(code, _) if code.code == rusqlite::ErrorCode::ConstraintViolation => {
            AppError::Validation("neispravna školska godina, ustanova ili datum".into())
        }
        _ => AppError::Database(e),
    })?;
    Ok(())
}

/// Breakfast opt-in for an IDSS enrolment (on = subscribe, off = cancel).
pub fn set_breakfast(tx: &Transaction, enrolment_id: &str, on: bool) -> AppResult<()> {
    let program: Option<String> = tx
        .query_row("SELECT program FROM enrolments WHERE id = ?1", params![enrolment_id], |r| r.get(0))
        .optional()?;
    match program.as_deref() {
        None => return Err(AppError::NotFound("upis ne postoji".into())),
        Some("PRIMARY_1_4") | Some("PRIMARY_5_9") => {}
        Some(_) => return Err(AppError::Validation("doručak se prijavljuje samo za školu IDSS".into())),
    }
    if on {
        tx.execute(
            "INSERT INTO enrolment_breakfast(enrolment_id, created_at) VALUES (?1, ?2) ON CONFLICT(enrolment_id) DO NOTHING",
            params![enrolment_id, now()],
        )?;
    } else {
        tx.execute("DELETE FROM enrolment_breakfast WHERE enrolment_id = ?1", params![enrolment_id])?;
    }
    Ok(())
}

/// Enrolments of a school year with breakfast.
pub fn list_breakfast(conn: &Connection, school_year: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT b.enrolment_id FROM enrolment_breakfast b JOIN enrolments e ON e.id = b.enrolment_id
         WHERE e.school_year = ?1 ORDER BY b.enrolment_id",
    )?;
    let rows = stmt.query_map(params![school_year], |r| r.get(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    fn rules(months: Vec<u32>) -> BoardBillingRules {
        BoardBillingRules {
            school_year: "2026/2027".into(),
            entity: "IDSS".into(),
            last_instalment_by: Some("2027-06-05".into()),
            breakfast_months: months,
            decision_ref: "ŠO 1/2026".into(),
        }
    }

    #[test]
    fn rules_round_trip_update_and_validation() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        let tx = conn.transaction().unwrap();
        save_rules(&tx, &rules(vec![9, 10, 11, 12, 1, 2, 3, 4, 5, 6])).unwrap();
        save_rules(&tx, &rules(vec![9, 10])).unwrap();
        assert!(matches!(save_rules(&tx, &rules(vec![9, 9])), Err(AppError::Validation(_))));
        assert!(matches!(save_rules(&tx, &rules(vec![13])), Err(AppError::Validation(_))));
        let mut no_ref = rules(vec![]);
        no_ref.decision_ref = " ".into();
        assert!(matches!(save_rules(&tx, &no_ref), Err(AppError::Validation(_))));
        tx.commit().unwrap();
        assert_eq!(list_rules(&conn, "2026/2027").unwrap(), vec![rules(vec![9, 10])]);
        assert!(rules_for(&conn, "2026/2027", "IMH").unwrap().is_none());
    }
}
