//! Read-only view of the audit log (CONSTITUTION BR-30; specs/dashboard-audit). There is deliberately no command that
//! edits or deletes an entry. Names are resolved from the encrypted database at read time; the log itself never stores
//! personal data (BR-22).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuditFilter {
    /// Inclusive date `YYYY-MM-DD` (local), or None.
    pub from: Option<String>,
    /// Inclusive date `YYYY-MM-DD` (local), or None.
    pub to: Option<String>,
    /// `INVOICES`, `FAMILIES`, `SYSTEM` or None for all.
    pub category: Option<String>,
    /// Free text over action, entity, id, details and the resolved name.
    pub search: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: i64,
    pub at: String,
    pub action: String,
    pub entity: String,
    pub entity_id: String,
    pub details: String,
    /// Readable name of the object (invoice number, family name, child name); None when the record no longer exists
    /// or the entity has no name.
    pub subject: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditPage {
    pub entries: Vec<AuditEntry>,
    /// Number of entries matching the filter (for „Učitaj još“).
    pub total: i64,
}

/// Entity kinds per category. Single source for the filter; the TypeScript labels mirror these names.
fn category_entities(category: &str) -> AppResult<&'static [&'static str]> {
    match category {
        "INVOICES" => Ok(&["invoice", "payment", "payment_plan", "document"]),
        "FAMILIES" => Ok(&["family", "child", "enrolment", "import_finding", "legacy"]),
        "SYSTEM" => Ok(&["legal_entity", "settings", "database", "recovery_key", "reference_data", "ministry_approval", "board_rules"]),
        _ => Err(AppError::Validation("nepoznata vrsta izmjene".into())),
    }
}

/// The readable name, resolved per entity kind. A payment is named by its invoice; an enrolment by its child.
const SUBJECT_SQL: &str = "CASE a.entity
    WHEN 'invoice' THEN (SELECT i.number FROM invoices i WHERE i.id = a.entity_id)
    WHEN 'payment' THEN (SELECT 'uplata na ' || i.number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = a.entity_id)
    WHEN 'family' THEN (SELECT f.display_name FROM families f WHERE f.id = a.entity_id)
    WHEN 'child' THEN (SELECT c.first_name || ' ' || c.last_name FROM children c WHERE c.id = a.entity_id)
    WHEN 'enrolment' THEN (SELECT c.first_name || ' ' || c.last_name || ' · ' || e.school_year FROM enrolments e
                           JOIN children c ON c.id = e.child_id WHERE e.id = a.entity_id)
    ELSE NULL END";

pub fn list_audit(conn: &Connection, filter: &AuditFilter) -> AppResult<AuditPage> {
    if !(1..=1000).contains(&filter.limit) || filter.offset < 0 {
        return Err(AppError::Validation("neispravan raspon dnevnika".into()));
    }
    let entities: Vec<&str> = match filter.category.as_deref() {
        Some(c) => category_entities(c)?.to_vec(),
        None => Vec::new(),
    };
    // `at` is local ISO time with offset; its first 10 characters are the local date.
    // lower() folds ASCII only, which covers numbers and codes; names are matched as typed for č/ć/š/ž/đ.
    let where_sql = "WHERE (?1 IS NULL OR substr(a.at, 1, 10) >= ?1)
           AND (?2 IS NULL OR substr(a.at, 1, 10) <= ?2)
           AND (?3 = '' OR instr(?3, '|' || a.entity || '|') > 0)
           AND (?4 = '' OR instr(lower(a.action || ' ' || a.entity || ' ' || a.entity_id || ' ' || a.details || ' ' ||
                                       COALESCE(a.subject, '')), lower(?4)) > 0)";
    let entity_list = if entities.is_empty() { String::new() } else { format!("|{}|", entities.join("|")) };
    let search = filter.search.as_deref().map(str::trim).unwrap_or("");
    let base = format!("SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.details, {SUBJECT_SQL} AS subject FROM audit_log a");
    let total: i64 = conn.query_row(
        &format!("SELECT count(*) FROM ({base}) a {where_sql}"),
        params![filter.from, filter.to, entity_list, search],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(&format!("SELECT * FROM ({base}) a {where_sql} ORDER BY a.id DESC LIMIT ?5 OFFSET ?6"))?;
    let entries = stmt
        .query_map(params![filter.from, filter.to, entity_list, search, filter.limit, filter.offset], |r| {
            Ok(AuditEntry {
                id: r.get(0)?,
                at: r.get(1)?,
                action: r.get(2)?,
                entity: r.get(3)?,
                entity_id: r.get(4)?,
                details: r.get(5)?,
                subject: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(AuditPage { entries, total })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO families(id, display_name, created_at) VALUES ('f1', 'Porodica Test', 'x');
             INSERT INTO children(id, family_id, first_name, last_name, date_of_birth, residency, created_at)
               VALUES ('c1', 'f1', 'Ana', 'Test', '2022-01-01', 'DOMESTIC', 'x');
             INSERT INTO enrolments(id, child_id, program, school_year, starts_on, status, created_at)
               VALUES ('e1', 'c1', 'TODDLERS', '2026/2027', '2026-09-01', 'ACTIVE', 'x');
             INSERT INTO invoices(id, number, entity, kind, family_id, buyer_name, issue_date, due_date, period_from, period_to,
                                  total_fenings, status, created_at)
               VALUES ('i1', 'IMH-001/26', 'IMH', 'MONTHLY', 'f1', 'B', '2026-10-01', '2026-10-05', '2026-10-01', '2026-10-31', 100, 'ISSUED', 'x');
             INSERT INTO payments(id, invoice_id, paid_on, amount, payer_name, reference, note, created_at)
               VALUES ('p1', 'i1', '2026-10-02', 100, 'B', '', '', 'x');
             INSERT INTO audit_log(at, action, entity, entity_id, details) VALUES
               ('2026-10-01T09:00:00+02:00', 'UPSERT', 'family', 'f1', '1 guardians'),
               ('2026-10-01T09:01:00+02:00', 'UPSERT', 'child', 'c1', ''),
               ('2026-10-01T09:02:00+02:00', 'UPSERT', 'enrolment', 'e1', ''),
               ('2026-10-02T10:00:00+02:00', 'ISSUE', 'invoice', 'i1', 'IMH-001/26 100'),
               ('2026-10-02T10:05:00+02:00', 'PAYMENT', 'payment', 'p1', ''),
               ('2026-10-03T08:00:00+02:00', 'DELETE', 'family', 'gone', ''),
               ('2026-10-04T08:00:00+02:00', 'BACKUP', 'database', '', '');",
        )
        .unwrap();
        conn
    }

    fn filter() -> AuditFilter {
        AuditFilter { limit: 100, ..Default::default() }
    }

    #[test]
    fn newest_first_with_resolved_names_and_deleted_records() {
        let page = list_audit(&db(), &filter()).unwrap();
        assert_eq!(page.total, 7);
        let subjects: Vec<(&str, Option<&str>)> = page.entries.iter().map(|e| (e.action.as_str(), e.subject.as_deref())).collect();
        assert_eq!(
            subjects,
            vec![
                ("BACKUP", None),
                ("DELETE", None),
                ("PAYMENT", Some("uplata na IMH-001/26")),
                ("ISSUE", Some("IMH-001/26")),
                ("UPSERT", Some("Ana Test · 2026/2027")),
                ("UPSERT", Some("Ana Test")),
                ("UPSERT", Some("Porodica Test")),
            ]
        );
    }

    #[test]
    fn filters_by_period_category_and_text_and_pages() {
        let conn = db();
        let period = list_audit(&conn, &AuditFilter { from: Some("2026-10-02".into()), to: Some("2026-10-03".into()), ..filter() }).unwrap();
        assert_eq!(period.entries.iter().map(|e| e.action.as_str()).collect::<Vec<_>>(), vec!["DELETE", "PAYMENT", "ISSUE"]);
        let invoices = list_audit(&conn, &AuditFilter { category: Some("INVOICES".into()), ..filter() }).unwrap();
        assert_eq!(invoices.total, 2);
        let families = list_audit(&conn, &AuditFilter { category: Some("FAMILIES".into()), ..filter() }).unwrap();
        assert_eq!(families.total, 4);
        let system = list_audit(&conn, &AuditFilter { category: Some("SYSTEM".into()), ..filter() }).unwrap();
        assert_eq!(system.total, 1);
        // the text search also finds the resolved name, case-insensitively
        let by_name = list_audit(&conn, &AuditFilter { search: Some("porodica test".into()), ..filter() }).unwrap();
        assert_eq!(by_name.total, 1);
        let by_number = list_audit(&conn, &AuditFilter { search: Some("imh-001".into()), ..filter() }).unwrap();
        assert_eq!(by_number.total, 2);
        let page2 = list_audit(&conn, &AuditFilter { limit: 3, offset: 3, ..filter() }).unwrap();
        assert_eq!((page2.total, page2.entries.len(), page2.entries[0].action.as_str()), (7, 3, "ISSUE"));
        assert!(list_audit(&conn, &AuditFilter { category: Some("X".into()), ..filter() }).is_err());
        assert!(list_audit(&conn, &AuditFilter { limit: 0, ..filter() }).is_err());
    }

    #[test]
    fn ten_thousand_entries_stay_fast() {
        let conn = db();
        conn.execute_batch(
            "WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM n WHERE k < 10000)
             INSERT INTO audit_log(at, action, entity, entity_id, details)
             SELECT '2026-11-' || printf('%02d', 1 + k % 28) || 'T10:00:00+01:00', 'ISSUE', 'invoice', 'i1', 'x' FROM n;",
        )
        .unwrap();
        let started = std::time::Instant::now();
        let page = list_audit(&conn, &AuditFilter { search: Some("imh".into()), limit: 200, ..filter() }).unwrap();
        assert_eq!((page.total, page.entries.len()), (10002, 200));
        assert!(started.elapsed().as_millis() < 2000, "took {:?}", started.elapsed());
    }
}
