//! Import from the previous Excel solution (BR-32). This module only READS cell values (no macros
//! are ever executed) and WRITES a plan prepared and validated by the TypeScript domain, in one
//! transaction. Amounts are taken as given; nothing is recalculated here.

use std::path::Path;

use calamine::{open_workbook_auto, Data, Reader};
use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::families::{save_child, save_family, Child, Family, Guardian};
use crate::repository::now;

/// One cell, typed so the TypeScript side can tell dates from text.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "t", content = "v")]
pub enum Cell {
    Empty,
    Text(String),
    Number(f64),
    /// ISO date `YYYY-MM-DD`.
    Date(String),
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LegacyWorkbook {
    pub file_name: String,
    pub db: Vec<Vec<Cell>>,
    pub setting: Vec<Vec<Cell>>,
}

/// Excel serial day (1900 system) → ISO date.
fn excel_date(serial: f64) -> Option<String> {
    if !(1.0..2_958_466.0).contains(&serial) {
        return None;
    }
    let base = chrono::NaiveDate::from_ymd_opt(1899, 12, 30)?;
    let date = base.checked_add_signed(chrono::Duration::days(serial.floor() as i64))?;
    Some(date.format("%Y-%m-%d").to_string())
}

fn to_cell(data: &Data) -> Cell {
    match data {
        Data::Empty => Cell::Empty,
        Data::String(s) => {
            if s.trim().is_empty() {
                Cell::Empty
            } else {
                Cell::Text(s.clone())
            }
        }
        Data::Float(f) => Cell::Number(*f),
        Data::Int(i) => Cell::Number(*i as f64),
        Data::Bool(b) => Cell::Text(b.to_string()),
        Data::DateTime(d) => excel_date(d.as_f64()).map(Cell::Date).unwrap_or(Cell::Empty),
        Data::DateTimeIso(s) => Cell::Date(s.chars().take(10).collect()),
        Data::DurationIso(s) => Cell::Text(s.clone()),
        Data::Error(_) => Cell::Empty,
    }
}

fn sheet(workbook: &mut calamine::Sheets<std::io::BufReader<std::fs::File>>, name: &str) -> AppResult<Vec<Vec<Cell>>> {
    let range = workbook
        .worksheet_range(name)
        .map_err(|_| AppError::Validation(format!("dokument nema list „{name}“")))?;
    // Absolute rows: prepend empty rows so row indexes match Excel (row 1 = index 0).
    let (start_row, start_col) = range.start().unwrap_or((0, 0));
    let mut rows: Vec<Vec<Cell>> = (0..start_row).map(|_| Vec::new()).collect();
    for row in range.rows() {
        let mut cells: Vec<Cell> = (0..start_col).map(|_| Cell::Empty).collect();
        cells.extend(row.iter().map(to_cell));
        rows.push(cells);
    }
    Ok(rows)
}

/// Read the sheets `DB` (invoices) and `Setting` (family register) of the old workbook.
pub fn read_workbook(path: &str) -> AppResult<LegacyWorkbook> {
    let file = Path::new(path);
    let extension = file.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if extension != "xlsm" && extension != "xlsx" {
        return Err(AppError::Validation("odaberite Excel dokument (.xlsm ili .xlsx)".into()));
    }
    let mut workbook = open_workbook_auto(file).map_err(|e| AppError::Validation(format!("dokument se ne može otvoriti: {e}")))?;
    if !matches!(workbook, calamine::Sheets::Xlsx(_)) {
        return Err(AppError::Validation("očekuje se Excel dokument (.xlsm ili .xlsx)".into()));
    }
    let db = sheet(&mut workbook, "DB")?;
    let setting = sheet(&mut workbook, "Setting")?;
    Ok(LegacyWorkbook {
        file_name: file.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string(),
        db,
        setting,
    })
}

// ---------- what is already imported (for re-imports) ----------

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LegacyKeys {
    pub families: Vec<(String, String)>,
    pub children: Vec<(String, String)>,
    /// (stored number, invoice id, paid fenings)
    pub invoices: Vec<(String, String, i64)>,
}

pub fn existing_keys(conn: &Connection) -> AppResult<LegacyKeys> {
    let pairs = |sql: &str| -> AppResult<Vec<(String, String)>> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    };
    let mut stmt = conn.prepare(
        "SELECT i.number, i.id, COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0)
         FROM invoices i WHERE i.source = 'LEGACY'",
    )?;
    let invoices = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(LegacyKeys {
        families: pairs("SELECT legacy_key, id FROM families WHERE legacy_key IS NOT NULL")?,
        children: pairs("SELECT legacy_key, id FROM children WHERE legacy_key IS NOT NULL")?,
        invoices,
    })
}

// ---------- the import plan (prepared by the TypeScript domain) ----------

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanFamily {
    pub family: Family,
    pub legacy_key: String,
    pub guardians: Vec<Guardian>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanChild {
    pub child: Child,
    pub legacy_key: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanLine {
    pub item_code: String,
    pub description: String,
    pub list_amount: i64,
    pub amount: i64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanPayment {
    pub id: String,
    pub paid_on: String,
    pub amount: i64,
    pub payer_name: String,
    pub note: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanInvoice {
    pub id: String,
    pub number: String,
    pub entity: String,
    pub kind: String,
    pub family_id: String,
    pub child_id: Option<String>,
    pub buyer_name: String,
    pub buyer_address: String,
    pub issue_date: String,
    pub due_date: String,
    pub period_from: String,
    pub period_to: String,
    pub total: i64,
    pub lines: Vec<PlanLine>,
    pub payment: Option<PlanPayment>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanExistingPayment {
    pub invoice_id: String,
    pub payment: PlanPayment,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanSequence {
    pub entity: String,
    pub year: i64,
    pub last_number: i64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlan {
    pub families: Vec<PlanFamily>,
    pub children: Vec<PlanChild>,
    pub invoices: Vec<PlanInvoice>,
    pub payments_for_existing: Vec<PlanExistingPayment>,
    pub sequences: Vec<PlanSequence>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub families: usize,
    pub children: usize,
    pub invoices: usize,
    pub payments: usize,
    /// (entity, year, next number) after the import
    pub next_numbers: Vec<(String, i64, i64)>,
}

fn insert_payment(tx: &Transaction, invoice_id: &str, p: &PlanPayment) -> AppResult<()> {
    if p.amount <= 0 {
        return Err(AppError::Validation("uvezena uplata mora biti veća od nule".into()));
    }
    tx.execute(
        "INSERT INTO payments(id, invoice_id, paid_on, amount, payer_name, reference, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?7)",
        params![p.id, invoice_id, p.paid_on, p.amount, p.payer_name, p.note, now()],
    )?;
    Ok(())
}

/// Write the plan in one transaction. Totals are re-checked against the lines (defence in depth).
pub fn import(tx: &Transaction, plan: &ImportPlan) -> AppResult<ImportResult> {
    for f in &plan.families {
        save_family(tx, &f.family, &f.guardians)?;
        tx.execute("UPDATE families SET legacy_key = ?1 WHERE id = ?2", params![f.legacy_key, f.family.id])?;
    }
    for c in &plan.children {
        save_child(tx, &c.child)?;
        tx.execute(
            "UPDATE children SET legacy_key = ?1, import_review = 1 WHERE id = ?2",
            params![c.legacy_key, c.child.id],
        )?;
    }
    let mut payments = 0;
    for invoice in &plan.invoices {
        if invoice.entity != "IMH" && invoice.entity != "IDSS" {
            return Err(AppError::Validation(format!("račun {}: nepoznata ustanova", invoice.number)));
        }
        if invoice.lines.iter().map(|l| l.amount).sum::<i64>() != invoice.total {
            return Err(AppError::Validation(format!("račun {}: zbir stavki se ne slaže s ukupnim iznosom", invoice.number)));
        }
        tx.execute(
            "INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, buyer_address, issue_date, due_date,
                                  period_from, period_to, total_fenings, status, created_at, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'ISSUED', ?14, 'LEGACY')",
            params![
                invoice.id, invoice.number, invoice.entity, invoice.kind, invoice.family_id, invoice.child_id,
                invoice.buyer_name, invoice.buyer_address, invoice.issue_date, invoice.due_date,
                invoice.period_from, invoice.period_to, invoice.total, now()
            ],
        )
        .map_err(|e| match &e {
            rusqlite::Error::SqliteFailure(code, _) if code.code == rusqlite::ErrorCode::ConstraintViolation => {
                AppError::Conflict(format!("račun {} već postoji ili nije ispravan", invoice.number))
            }
            _ => AppError::Database(e),
        })?;
        for (index, line) in invoice.lines.iter().enumerate() {
            tx.execute(
                "INSERT INTO invoice_lines(id, invoice_id, position, item_code, description, child_id, list_amount, amount)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    format!("{}-{}", invoice.id, index + 1), invoice.id, (index + 1) as i64, line.item_code,
                    line.description, invoice.child_id, line.list_amount, line.amount
                ],
            )?;
        }
        if let Some(payment) = &invoice.payment {
            insert_payment(tx, &invoice.id, payment)?;
            payments += 1;
        }
    }
    for existing in &plan.payments_for_existing {
        insert_payment(tx, &existing.invoice_id, &existing.payment)?;
        payments += 1;
    }
    let mut next_numbers = Vec::new();
    for s in &plan.sequences {
        let last: i64 = tx.query_row(
            "INSERT INTO invoice_sequences(entity, year, last_number) VALUES (?1, ?2, ?3)
             ON CONFLICT(entity, year) DO UPDATE SET last_number = max(last_number, excluded.last_number)
             RETURNING last_number",
            params![s.entity, s.year, s.last_number],
            |r| r.get(0),
        )?;
        next_numbers.push((s.entity.clone(), s.year, last + 1));
    }
    Ok(ImportResult {
        families: plan.families.len(),
        children: plan.children.len(),
        invoices: plan.invoices.len(),
        payments,
        next_numbers,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::invoices::{issue_invoice, InvoiceDraft, InvoiceLine};
    use crate::migrations;

    const F: &str = "00000000-0000-4000-8000-000000000001";

    fn plan() -> ImportPlan {
        ImportPlan {
            families: vec![PlanFamily {
                family: Family { id: F.into(), display_name: "Test".into(), address: "Ulica 1".into() },
                legacy_key: "otac|majka".into(),
                guardians: vec![Guardian {
                    id: "g1".into(), family_id: F.into(), full_name: "Otac".into(), role: "FATHER".into(),
                    email: "".into(), phone: "".into(), iban: "".into(), is_payer: true,
                }],
            }],
            children: vec![PlanChild {
                child: Child {
                    id: "c1".into(), family_id: F.into(), first_name: "A".into(), last_name: "T".into(),
                    date_of_birth: None, residency: "DOMESTIC".into(), citizen_bih: true, residence_ks: true, import_review: true,
                },
                legacy_key: "otac|majka|a t".into(),
            }],
            invoices: vec![
                PlanInvoice {
                    id: "i1".into(), number: "IMH 896/26".into(), entity: "IMH".into(), kind: "OTHER".into(),
                    family_id: F.into(), child_id: Some("c1".into()), buyer_name: "Otac".into(), buyer_address: "".into(),
                    issue_date: "2026-09-20".into(), due_date: "2026-10-05".into(), period_from: "2026-10-01".into(),
                    period_to: "2026-10-31".into(), total: 71000,
                    lines: vec![PlanLine { item_code: "TUITION".into(), description: "Školarina".into(), list_amount: 71000, amount: 71000 }],
                    payment: Some(PlanPayment { id: "p1".into(), paid_on: "2026-10-05".into(), amount: 71000, payer_name: "Otac".into(), note: "Excel".into() }),
                },
                PlanInvoice {
                    id: "k1".into(), number: "IDSS KO-35/26".into(), entity: "IDSS".into(), kind: "CREDIT_NOTE".into(),
                    family_id: F.into(), child_id: None, buyer_name: "Otac".into(), buyer_address: "".into(),
                    issue_date: "2026-09-20".into(), due_date: "2026-09-20".into(), period_from: "2026-09-01".into(),
                    period_to: "2026-09-30".into(), total: -91916,
                    lines: vec![PlanLine { item_code: "OTHER".into(), description: "Knjižno odobrenje".into(), list_amount: -91916, amount: -91916 }],
                    payment: None,
                },
            ],
            payments_for_existing: vec![],
            sequences: vec![PlanSequence { entity: "IMH".into(), year: 2026, last_number: 896 }],
        }
    }

    #[test]
    fn imports_families_children_invoices_and_continues_numbering() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        let tx = conn.transaction().unwrap();
        let result = import(&tx, &plan()).unwrap();
        assert_eq!(result.next_numbers, vec![("IMH".to_string(), 2026, 897)]);
        assert_eq!((result.families, result.children, result.invoices, result.payments), (1, 1, 2, 1));
        // the next invoice issued in the app continues after the imported state
        let draft = InvoiceDraft {
            id: "n1".into(), entity: "IMH".into(), kind: "OTHER".into(), family_id: F.into(), child_id: "c1".into(),
            buyer_name: "Otac".into(), buyer_address: "".into(), issue_date: "2026-11-01".into(), due_date: "2026-11-05".into(),
            period_from: "2026-11-01".into(), period_to: "2026-11-30".into(), total: 100, plan_items: vec![],
            lines: vec![InvoiceLine {
                item_code: "OTHER".into(), description: "x".into(), child_id: "c1".into(), enrolment_id: "e".into(),
                program: "TODDLERS".into(), list_amount: 100, board_decision_id: None, amount: 100,
            }],
        };
        // enrolment "e" does not exist: insert one so the line's foreign key holds
        tx.execute(
            "INSERT INTO enrolments(id, child_id, program, school_year, starts_on, status, created_at) VALUES ('e', 'c1', 'TODDLERS', '2026/2027', '2026-09-01', 'ACTIVE', 'x')",
            [],
        )
        .unwrap();
        assert_eq!(issue_invoice(&tx, &draft).unwrap(), "IMH-897/26");
        let review: i64 = tx.query_row("SELECT import_review FROM children WHERE id = 'c1'", [], |r| r.get(0)).unwrap();
        assert_eq!(review, 1);
        tx.commit().unwrap();
        let keys = existing_keys(&conn).unwrap();
        assert_eq!(keys.families, vec![("otac|majka".to_string(), F.to_string())]);
        assert_eq!(keys.invoices.len(), 2);
    }

    #[test]
    fn refuses_duplicates_and_wrong_totals() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        let tx = conn.transaction().unwrap();
        import(&tx, &plan()).unwrap();
        let mut again = plan();
        again.families.clear();
        again.children.clear();
        again.invoices.truncate(1);
        again.invoices[0].id = "i2".into();
        again.invoices[0].payment = None;
        assert!(matches!(import(&tx, &again), Err(AppError::Conflict(_))));
        let mut wrong = plan();
        wrong.families.clear();
        wrong.children.clear();
        wrong.invoices.truncate(1);
        wrong.invoices[0].number = "IMH 900/26".into();
        wrong.invoices[0].id = "i3".into();
        wrong.invoices[0].total = 1;
        assert!(matches!(import(&tx, &wrong), Err(AppError::Validation(_))));
    }

    /// Manual check against a real workbook (never committed): `LEGACY_XLSM=<path> cargo test reads_real -- --ignored`.
    /// Prints only shapes and counts — no personal data.
    #[test]
    #[ignore]
    fn reads_real_workbook_shape() {
        let path = std::env::var("LEGACY_XLSM").expect("set LEGACY_XLSM");
        let book = read_workbook(&path).unwrap();
        let dates = book.db.iter().flatten().filter(|c| matches!(c, Cell::Date(_))).count();
        println!("db rows {}, setting rows {}, date cells {}", book.db.len(), book.setting.len(), dates);
        if let Ok(out) = std::env::var("LEGACY_JSON_OUT") {
            std::fs::write(out, serde_json::to_vec(&book).unwrap()).unwrap();
        }
        assert!(book.db.len() > 8 && dates > 0);
    }

    /// Manual end-to-end check: `LEGACY_PLAN=<plan.json> cargo test imports_real -- --ignored` imports a plan
    /// built by the TypeScript domain into an in-memory database. Prints only counts.
    #[test]
    #[ignore]
    fn imports_real_plan_in_memory() {
        let path = std::env::var("LEGACY_PLAN").expect("set LEGACY_PLAN");
        let plan: ImportPlan = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        let tx = conn.transaction().unwrap();
        let result = import(&tx, &plan).unwrap();
        tx.commit().unwrap();
        let (invoices, lines, payments): (i64, i64, i64) = conn
            .query_row(
                "SELECT (SELECT count(*) FROM invoices), (SELECT count(*) FROM invoice_lines), (SELECT count(*) FROM payments)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        let violations: i64 = conn.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
        println!("result {result:?}; db invoices {invoices}, lines {lines}, payments {payments}, fk violations {violations}");
        assert_eq!(violations, 0);
    }

    #[test]
    fn excel_serial_dates() {
        assert_eq!(excel_date(46023.0).as_deref(), Some("2026-01-01"));
        assert_eq!(excel_date(0.5), None);
    }
}
