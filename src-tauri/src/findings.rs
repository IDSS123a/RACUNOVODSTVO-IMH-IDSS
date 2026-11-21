//! Findings of the legacy import (specs/legacy-import-diagnostics, migration 009).
//! The TypeScript domain detects and categorises; this layer stores them in the import
//! transaction, lists them, and records their resolution (audited by the command, BR-30).
//! Reasons carry no personal data (BR-22); names are joined from the invoice for display only.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::repository::now;

/// Longest resolution note accepted (characters).
const NOTE_MAX: usize = 500;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanFinding {
    pub finding_key: String,
    pub category: String,
    pub severity: String,
    pub entity: String,
    pub number: String,
    pub excel_rows: String,
    pub reason: String,
    pub amount: Option<i64>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FindingRow {
    pub id: String,
    pub category: String,
    pub severity: String,
    pub entity: String,
    pub number: String,
    pub invoice_id: Option<String>,
    pub buyer_name: String,
    pub child_name: String,
    pub excel_rows: String,
    pub reason: String,
    pub amount: Option<i64>,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub last_seen_file: String,
    pub resolved_at: Option<String>,
    pub resolution_note: String,
}

/// Store the findings of one import (insert, or refresh by `finding_key` keeping the resolution).
/// Only ISOLATE / REVIEW / INFO are accepted; BLOCK findings stop an import and are never stored.
/// Returns the number of findings written.
pub fn store(tx: &Transaction, findings: &[PlanFinding], file_name: &str) -> AppResult<usize> {
    let seen_at = now();
    for f in findings {
        if !matches!(f.severity.as_str(), "ISOLATE" | "REVIEW" | "INFO") {
            return Err(AppError::Validation(format!("nalaz {}: nedozvoljena težina", f.category)));
        }
        if f.finding_key.trim().is_empty() || f.reason.trim().is_empty() {
            return Err(AppError::Validation(format!("nalaz {}: nedostaje ključ ili razlog", f.category)));
        }
        // An isolated record was not imported: it must not point to the invoice that kept the number.
        let invoice_id: Option<String> = if f.severity == "ISOLATE" || f.number.is_empty() {
            None
        } else {
            tx.query_row(
                "SELECT id FROM invoices WHERE number = ?1",
                params![format!("{} {}", f.entity, f.number)],
                |r| r.get(0),
            )
            .optional()?
        };
        tx.execute(
            "INSERT INTO legacy_import_findings(id, finding_key, category, severity, entity, number, invoice_id, excel_rows,
                                                reason, amount, first_seen_at, last_seen_at, last_seen_file)
             VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11)
             ON CONFLICT(finding_key) DO UPDATE SET
               severity = excluded.severity,
               invoice_id = COALESCE(excluded.invoice_id, legacy_import_findings.invoice_id),
               excel_rows = excluded.excel_rows,
               reason = excluded.reason,
               amount = excluded.amount,
               last_seen_at = excluded.last_seen_at,
               last_seen_file = excluded.last_seen_file",
            params![
                f.finding_key, f.category, f.severity, f.entity, f.number, invoice_id, f.excel_rows, f.reason, f.amount,
                seen_at, file_name
            ],
        )?;
    }
    Ok(findings.len())
}

/// All findings, open first (ISOLATE, REVIEW, INFO), then resolved; optionally only the open ones.
pub fn list(conn: &Connection, only_open: bool) -> AppResult<Vec<FindingRow>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.category, f.severity, f.entity, f.number, f.invoice_id,
                COALESCE(i.buyer_name, ''), COALESCE(c.first_name || ' ' || c.last_name, ''),
                f.excel_rows, f.reason, f.amount, f.first_seen_at, f.last_seen_at, f.last_seen_file,
                f.resolved_at, f.resolution_note
         FROM legacy_import_findings f
         LEFT JOIN invoices i ON i.id = f.invoice_id
         LEFT JOIN children c ON c.id = i.child_id
         WHERE (?1 = 0 OR f.resolved_at IS NULL)
         ORDER BY f.resolved_at IS NOT NULL,
                  CASE f.severity WHEN 'ISOLATE' THEN 0 WHEN 'REVIEW' THEN 1 ELSE 2 END,
                  f.category, f.entity, f.number",
    )?;
    let rows = stmt.query_map(params![only_open as i64], |r| {
        Ok(FindingRow {
            id: r.get(0)?,
            category: r.get(1)?,
            severity: r.get(2)?,
            entity: r.get(3)?,
            number: r.get(4)?,
            invoice_id: r.get(5)?,
            buyer_name: r.get(6)?,
            child_name: r.get(7)?,
            excel_rows: r.get(8)?,
            reason: r.get(9)?,
            amount: r.get(10)?,
            first_seen_at: r.get(11)?,
            last_seen_at: r.get(12)?,
            last_seen_file: r.get(13)?,
            resolved_at: r.get(14)?,
            resolution_note: r.get(15)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Number of open findings that need the operator (ISOLATE and REVIEW; INFO is listed only).
pub fn open_count(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT count(*) FROM legacy_import_findings WHERE resolved_at IS NULL AND severity IN ('ISOLATE', 'REVIEW')",
        [],
        |r| r.get(0),
    )?)
}

/// Mark one open finding resolved with the operator's note. Returns its category (for the audit entry).
pub fn resolve(tx: &Transaction, id: &str, note: &str) -> AppResult<String> {
    let note = note.trim();
    if note.is_empty() {
        return Err(AppError::Validation("upišite kako je nalaz riješen".into()));
    }
    if note.chars().count() > NOTE_MAX {
        return Err(AppError::Validation(format!("bilješka može imati najviše {NOTE_MAX} znakova")));
    }
    let current: Option<(String, Option<String>)> = tx
        .query_row("SELECT category, resolved_at FROM legacy_import_findings WHERE id = ?1", params![id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    match current {
        None => Err(AppError::NotFound("nalaz ne postoji".into())),
        Some((_, Some(_))) => Err(AppError::Conflict("nalaz je već riješen".into())),
        Some((category, None)) => {
            tx.execute(
                "UPDATE legacy_import_findings SET resolved_at = ?1, resolution_note = ?2 WHERE id = ?3 AND resolved_at IS NULL",
                params![now(), note, id],
            )?;
            Ok(category)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO families(id, display_name, created_at) VALUES ('f1', 'Test', 'now');
             INSERT INTO invoices(id, number, entity, kind, family_id, buyer_name, issue_date, due_date, period_from, period_to,
                                  total_fenings, status, created_at, source)
             VALUES ('i1', 'IMH 002/26', 'IMH', 'OTHER', 'f1', 'Kupac', '2026-10-01', '2026-10-01', '2026-10-01', '2026-10-31',
                     71000, 'ISSUED', 'now', 'LEGACY');",
        )
        .unwrap();
        conn
    }

    fn finding(key: &str, category: &str, severity: &str, number: &str, rows: &str) -> PlanFinding {
        PlanFinding {
            finding_key: key.into(),
            category: category.into(),
            severity: severity.into(),
            entity: "IMH".into(),
            number: number.into(),
            excel_rows: rows.into(),
            reason: "Rok nije upisan; uzet je datum računa.".into(),
            amount: Some(71000),
        }
    }

    #[test]
    fn stores_links_to_the_invoice_and_never_links_isolated_records() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        let written = store(
            &tx,
            &[
                finding("DUE_DATE_INVALID|IMH|002/26", "DUE_DATE_INVALID", "REVIEW", "002/26", "DB 10"),
                finding("NUMBER_REUSED_OTHER_PARTY|IMH|002/26|1", "NUMBER_REUSED_OTHER_PARTY", "ISOLATE", "002/26", "DB 40"),
                finding("NUMBER_GAPS|IMH|…/26", "NUMBER_GAPS", "INFO", "…/26", ""),
            ],
            "stari.xlsm",
        )
        .unwrap();
        tx.commit().unwrap();
        assert_eq!(written, 3);
        let all = list(&conn, false).unwrap();
        assert_eq!(all.iter().map(|f| f.severity.as_str()).collect::<Vec<_>>(), vec!["ISOLATE", "REVIEW", "INFO"]);
        assert_eq!(all[0].invoice_id, None, "an isolated record was not imported");
        assert_eq!(all[1].invoice_id.as_deref(), Some("i1"));
        assert_eq!(all[1].buyer_name, "Kupac");
        assert_eq!(open_count(&conn).unwrap(), 2, "INFO is not counted as open work");
    }

    #[test]
    fn rejects_blocking_and_unknown_categories() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        assert!(matches!(
            store(&tx, &[finding("k", "AMOUNT_UNREADABLE", "BLOCK", "1/26", "")], "x"),
            Err(AppError::Validation(_))
        ));
        assert!(store(&tx, &[finding("k", "SOMETHING_ELSE", "REVIEW", "1/26", "")], "x").is_err(), "CHECK constraint");
    }

    #[test]
    fn resolve_needs_a_note_and_happens_once() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        store(&tx, &[finding("DUE_DATE_INVALID|IMH|002/26", "DUE_DATE_INVALID", "REVIEW", "002/26", "DB 10")], "a.xlsm").unwrap();
        let id: String = tx.query_row("SELECT id FROM legacy_import_findings", [], |r| r.get(0)).unwrap();
        assert!(matches!(resolve(&tx, &id, "   "), Err(AppError::Validation(_))));
        assert!(matches!(resolve(&tx, &id, &"x".repeat(NOTE_MAX + 1)), Err(AppError::Validation(_))));
        assert_eq!(resolve(&tx, &id, "Rok dogovoren s knjigovođom").unwrap(), "DUE_DATE_INVALID");
        assert!(matches!(resolve(&tx, &id, "opet"), Err(AppError::Conflict(_))));
        assert!(matches!(resolve(&tx, "nema", "x"), Err(AppError::NotFound(_))));
        tx.commit().unwrap();
        assert_eq!(open_count(&conn).unwrap(), 0);
        assert_eq!(list(&conn, true).unwrap().len(), 0);
        assert_eq!(list(&conn, false).unwrap()[0].resolution_note, "Rok dogovoren s knjigovođom");
    }

    #[test]
    fn reimport_refreshes_rows_and_file_but_keeps_the_resolution() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        store(&tx, &[finding("DUE_DATE_INVALID|IMH|002/26", "DUE_DATE_INVALID", "REVIEW", "002/26", "DB 10")], "prvi.xlsm").unwrap();
        let id: String = tx.query_row("SELECT id FROM legacy_import_findings", [], |r| r.get(0)).unwrap();
        resolve(&tx, &id, "provjereno").unwrap();
        store(&tx, &[finding("DUE_DATE_INVALID|IMH|002/26", "DUE_DATE_INVALID", "REVIEW", "002/26", "DB 12")], "drugi.xlsm").unwrap();
        tx.commit().unwrap();
        let all = list(&conn, false).unwrap();
        assert_eq!(all.len(), 1, "no duplicate on re-import");
        assert_eq!((all[0].excel_rows.as_str(), all[0].last_seen_file.as_str()), ("DB 12", "drugi.xlsm"));
        assert!(all[0].resolved_at.is_some(), "the resolution survives the re-import");
        assert_eq!(all[0].id, id);
    }
}
