//! SQL for invoices, numbering, payments and IDSS payment plans (Commander A-3).
//! Amounts are computed by the TypeScript domain; this layer persists them, assigns the
//! invoice number inside the same transaction (BR-23) and re-checks totals (defence in depth).

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::repository::now;

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceLine {
    pub item_code: String,
    pub description: String,
    pub child_id: String,
    pub enrolment_id: String,
    pub program: String,
    pub list_amount: i64,
    pub board_decision_id: Option<String>,
    pub amount: i64,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceDraft {
    pub id: String,
    pub entity: String,
    pub kind: String,
    pub family_id: String,
    pub buyer_name: String,
    pub buyer_address: String,
    pub issue_date: String,
    pub due_date: String,
    pub period_from: String,
    pub period_to: String,
    pub lines: Vec<InvoiceLine>,
    pub total: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceSummary {
    pub id: String,
    pub number: String,
    pub entity: String,
    pub kind: String,
    pub family_id: String,
    pub family_name: String,
    pub buyer_name: String,
    pub buyer_address: String,
    pub issue_date: String,
    pub due_date: String,
    pub period_from: String,
    pub period_to: String,
    pub total: i64,
    pub paid: i64,
    pub status: String,
}

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub id: String,
    pub invoice_id: String,
    pub paid_on: String,
    pub amount: i64,
    pub payer_name: String,
    pub reference: String,
    pub note: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceDetail {
    pub invoice: InvoiceSummary,
    pub lines: Vec<InvoiceLine>,
    pub payments: Vec<Payment>,
}

fn entity_of_program(program: &str) -> &'static str {
    // Mirrors PROGRAM_ENTITY (src/features/price-lists/types.ts) as a server-side guard only.
    if program == "PRIMARY_1_4" || program == "PRIMARY_5_9" { "IDSS" } else { "IMH" }
}

/// Assign the next number for an entity and the year of the issue date, e.g. `IMH-001/26` (BR-23).
/// Runs inside the issuing transaction, so numbers are gap-free and never duplicated.
pub fn next_number(tx: &Transaction, entity: &str, issue_date: &str) -> AppResult<String> {
    let year: i64 = issue_date
        .get(0..4)
        .and_then(|y| y.parse().ok())
        .ok_or_else(|| AppError::Validation("neispravan datum računa".into()))?;
    let sequence: i64 = tx.query_row(
        "INSERT INTO invoice_sequences(entity, year, last_number) VALUES (?1, ?2, 1)
         ON CONFLICT(entity, year) DO UPDATE SET last_number = last_number + 1
         RETURNING last_number",
        params![entity, year],
        |r| r.get(0),
    )?;
    Ok(format!("{entity}-{sequence:03}/{:02}", year % 100))
}

/// Issue an invoice: validate, number, insert header and lines. Returns the assigned number.
pub fn issue_invoice(tx: &Transaction, draft: &InvoiceDraft) -> AppResult<String> {
    if draft.lines.is_empty() {
        return Err(AppError::Validation("račun mora imati barem jednu stavku".into()));
    }
    let line_sum: i64 = draft.lines.iter().map(|l| l.amount).sum();
    if line_sum != draft.total {
        return Err(AppError::Validation("zbir stavki se ne slaže s ukupnim iznosom".into()));
    }
    if draft.lines.iter().any(|l| entity_of_program(&l.program) != draft.entity) {
        return Err(AppError::Validation("račun ne smije miješati stavke IMH i IDSS".into()));
    }
    let number = next_number(tx, &draft.entity, &draft.issue_date)?;
    tx.execute(
        "INSERT INTO invoices(id, number, entity, kind, family_id, buyer_name, buyer_address, issue_date, due_date,
                              period_from, period_to, total_fenings, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'ISSUED', ?13)",
        params![
            draft.id, number, draft.entity, draft.kind, draft.family_id, draft.buyer_name, draft.buyer_address,
            draft.issue_date, draft.due_date, draft.period_from, draft.period_to, draft.total, now()
        ],
    )
    .map_err(|e| match &e {
        rusqlite::Error::SqliteFailure(code, _) if code.code == rusqlite::ErrorCode::ConstraintViolation => {
            AppError::Conflict("za ovu porodicu i mjesec račun je već izdat".into())
        }
        _ => AppError::Database(e),
    })?;
    for (index, line) in draft.lines.iter().enumerate() {
        tx.execute(
            "INSERT INTO invoice_lines(id, invoice_id, position, item_code, description, child_id, enrolment_id, program,
                                       list_amount, board_decision_id, amount)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                format!("{}-{}", draft.id, index + 1), draft.id, (index + 1) as i64, line.item_code, line.description,
                line.child_id, line.enrolment_id, line.program, line.list_amount, line.board_decision_id, line.amount
            ],
        )?;
    }
    Ok(number)
}

const SUMMARY_SELECT: &str = "SELECT i.id, i.number, i.entity, i.kind, i.family_id, f.display_name, i.buyer_name, i.buyer_address,
        i.issue_date, i.due_date, i.period_from, i.period_to, i.total_fenings,
        COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0), i.status
 FROM invoices i JOIN families f ON f.id = i.family_id";

fn map_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<InvoiceSummary> {
    Ok(InvoiceSummary {
        id: r.get(0)?,
        number: r.get(1)?,
        entity: r.get(2)?,
        kind: r.get(3)?,
        family_id: r.get(4)?,
        family_name: r.get(5)?,
        buyer_name: r.get(6)?,
        buyer_address: r.get(7)?,
        issue_date: r.get(8)?,
        due_date: r.get(9)?,
        period_from: r.get(10)?,
        period_to: r.get(11)?,
        total: r.get(12)?,
        paid: r.get(13)?,
        status: r.get(14)?,
    })
}

/// Invoices, optionally filtered by entity and by month ("YYYY-MM" of the period start), newest first.
pub fn list_invoices(conn: &Connection, entity: Option<&str>, month: Option<&str>) -> AppResult<Vec<InvoiceSummary>> {
    let sql = format!(
        "{SUMMARY_SELECT} WHERE (?1 IS NULL OR i.entity = ?1) AND (?2 IS NULL OR substr(i.period_from, 1, 7) = ?2)
         ORDER BY i.issue_date DESC, i.number DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![entity, month], map_summary)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_invoice(conn: &Connection, invoice_id: &str) -> AppResult<Option<InvoiceDetail>> {
    let sql = format!("{SUMMARY_SELECT} WHERE i.id = ?1");
    let Some(invoice) = conn.query_row(&sql, params![invoice_id], map_summary).optional()? else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT item_code, description, child_id, enrolment_id, program, list_amount, board_decision_id, amount
         FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position",
    )?;
    let lines = stmt
        .query_map(params![invoice_id], |r| {
            Ok(InvoiceLine {
                item_code: r.get(0)?,
                description: r.get(1)?,
                child_id: r.get(2)?,
                enrolment_id: r.get(3)?,
                program: r.get(4)?,
                list_amount: r.get(5)?,
                board_decision_id: r.get(6)?,
                amount: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT id, invoice_id, paid_on, amount, payer_name, reference, note FROM payments
         WHERE invoice_id = ?1 ORDER BY paid_on, created_at",
    )?;
    let payments = stmt
        .query_map(params![invoice_id], |r| {
            Ok(Payment {
                id: r.get(0)?,
                invoice_id: r.get(1)?,
                paid_on: r.get(2)?,
                amount: r.get(3)?,
                payer_name: r.get(4)?,
                reference: r.get(5)?,
                note: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(InvoiceDetail { invoice, lines, payments }))
}

/// Book a payment against an issued invoice. Overpayments are allowed and kept as credit.
pub fn record_payment(tx: &Transaction, payment: &Payment) -> AppResult<()> {
    let status: Option<String> = tx
        .query_row("SELECT status FROM invoices WHERE id = ?1", params![payment.invoice_id], |r| r.get(0))
        .optional()?;
    match status.as_deref() {
        None => return Err(AppError::NotFound("račun ne postoji".into())),
        Some("ISSUED") => {}
        Some(_) => return Err(AppError::Conflict("uplata se ne može knjižiti na storniran račun".into())),
    }
    if payment.amount <= 0 {
        return Err(AppError::Validation("iznos uplate mora biti veći od nule".into()));
    }
    tx.execute(
        "INSERT INTO payments(id, invoice_id, paid_on, amount, payer_name, reference, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            payment.id, payment.invoice_id, payment.paid_on, payment.amount, payment.payer_name,
            payment.reference, payment.note, now()
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::families::{save_child, save_enrolment, save_family, Child, Enrolment, Family, Guardian};
    use crate::migrations;

    const F: &str = "00000000-0000-4000-8000-000000000001";

    fn db_with_family() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        let tx = conn.transaction().unwrap();
        save_family(
            &tx,
            &Family { id: F.into(), display_name: "Test".into(), address: "Buka".into() },
            &[Guardian {
                id: "g1".into(), family_id: F.into(), full_name: "Majka".into(), role: "MOTHER".into(),
                email: "".into(), phone: "".into(), iban: "".into(), is_payer: true,
            }],
        )
        .unwrap();
        save_child(&tx, &Child {
            id: "c1".into(), family_id: F.into(), first_name: "A".into(), last_name: "T".into(),
            date_of_birth: "2022-01-01".into(), residency: "DOMESTIC".into(), citizen_bih: true, residence_ks: true,
        })
        .unwrap();
        save_enrolment(&tx, &Enrolment {
            id: "e1".into(), child_id: "c1".into(), program: "TODDLERS".into(), school_year: "2026/2027".into(),
            starts_on: "2026-09-01".into(), ends_on: None, status: "ACTIVE".into(),
        })
        .unwrap();
        tx.commit().unwrap();
        conn
    }

    fn draft(id: &str, period: &str, issue: &str, kind: &str) -> InvoiceDraft {
        InvoiceDraft {
            id: id.into(),
            entity: "IMH".into(),
            kind: kind.into(),
            family_id: F.into(),
            buyer_name: "Majka".into(),
            buyer_address: "Buka".into(),
            issue_date: issue.into(),
            due_date: issue.into(),
            period_from: format!("{period}-01"),
            period_to: format!("{period}-28"),
            lines: vec![InvoiceLine {
                item_code: "TUITION".into(), description: "Školarina".into(), child_id: "c1".into(),
                enrolment_id: "e1".into(), program: "TODDLERS".into(), list_amount: 71000, board_decision_id: None, amount: 71000,
            }],
            total: 71000,
        }
    }

    #[test]
    fn numbers_are_sequential_per_entity_and_restart_each_year() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        assert_eq!(issue_invoice(&tx, &draft("i1", "2026-09", "2026-09-01", "MONTHLY")).unwrap(), "IMH-001/26");
        assert_eq!(issue_invoice(&tx, &draft("i2", "2026-10", "2026-10-01", "MONTHLY")).unwrap(), "IMH-002/26");
        assert_eq!(next_number(&tx, "IDSS", "2026-10-01").unwrap(), "IDSS-001/26");
        assert_eq!(issue_invoice(&tx, &draft("i3", "2027-01", "2027-01-02", "MONTHLY")).unwrap(), "IMH-001/27");
        tx.commit().unwrap();
        let all = list_invoices(&conn, Some("IMH"), None).unwrap();
        assert_eq!(all.iter().map(|i| i.number.as_str()).collect::<Vec<_>>(), vec!["IMH-001/27", "IMH-002/26", "IMH-001/26"]);
    }

    #[test]
    fn many_invoices_get_unique_gap_free_numbers() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        for n in 1..=150 {
            let number = issue_invoice(&tx, &draft(&format!("x{n}"), "2026-09", "2026-09-01", "OTHER")).unwrap();
            assert_eq!(number, format!("IMH-{n:03}/26"));
        }
    }

    #[test]
    fn rejects_double_monthly_invoice_mixed_entities_and_wrong_totals() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        issue_invoice(&tx, &draft("i1", "2026-10", "2026-10-01", "MONTHLY")).unwrap();
        assert!(matches!(issue_invoice(&tx, &draft("i2", "2026-10", "2026-10-02", "MONTHLY")), Err(AppError::Conflict(_))));
        let mut wrong = draft("i3", "2026-11", "2026-11-01", "MONTHLY");
        wrong.total = 1;
        assert!(matches!(issue_invoice(&tx, &wrong), Err(AppError::Validation(_))));
        let mut mixed = draft("i4", "2026-12", "2026-12-01", "MONTHLY");
        mixed.lines[0].program = "PRIMARY_1_4".into();
        assert!(matches!(issue_invoice(&tx, &mixed), Err(AppError::Validation(_))));
    }

    #[test]
    fn invoice_and_payment_round_trip_e14() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        let d = draft("i1", "2026-10", "2026-10-01", "MONTHLY");
        issue_invoice(&tx, &d).unwrap();
        let payment = Payment {
            id: "p1".into(), invoice_id: "i1".into(), paid_on: "2026-10-04".into(), amount: 50000,
            payer_name: "Baka".into(), reference: "Sparkasse 123".into(), note: "".into(),
        };
        record_payment(&tx, &payment).unwrap();
        tx.commit().unwrap();
        let detail = get_invoice(&conn, "i1").unwrap().unwrap();
        assert_eq!(detail.lines, d.lines);
        assert_eq!(detail.payments, vec![payment]);
        assert_eq!(detail.invoice.paid, 50000);
        assert_eq!(detail.invoice.family_name, "Test");
        assert!(get_invoice(&conn, "missing").unwrap().is_none());
    }
}
