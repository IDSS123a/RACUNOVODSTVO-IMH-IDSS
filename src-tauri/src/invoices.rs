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
    pub child_id: String,
    pub buyer_name: String,
    pub buyer_address: String,
    pub issue_date: String,
    pub due_date: String,
    pub period_from: String,
    pub period_to: String,
    pub lines: Vec<InvoiceLine>,
    pub total: i64,
    /// IDSS plan instalments billed by this invoice; each is marked invoiced exactly once.
    #[serde(default)]
    pub plan_items: Vec<PlanItemRef>,
}

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanItemRef {
    pub plan_id: String,
    pub sequence: i64,
}

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub sequence: i64,
    pub due_date: String,
    pub amount: i64,
    pub invoice_id: Option<String>,
}

/// IDSS payment plan for one enrolment and item (BR-11). Amounts come from the TypeScript domain.
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentPlan {
    pub id: String,
    pub enrolment_id: String,
    pub child_id: String,
    pub item_code: String,
    pub instalments: i64,
    pub total: i64,
    pub items: Vec<PlanItem>,
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
    pub child_id: String,
    pub child_name: String,
    /// APP (issued here) or LEGACY (imported from the previous solution, BR-32).
    pub source: String,
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
    if draft.lines.iter().any(|l| l.child_id != draft.child_id) {
        return Err(AppError::Validation("račun se izdaje za jedno dijete — sve stavke moraju biti za to dijete".into()));
    }
    let number = next_number(tx, &draft.entity, &draft.issue_date)?;
    tx.execute(
        "INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, buyer_address, issue_date, due_date,
                              period_from, period_to, total_fenings, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'ISSUED', ?14)",
        params![
            draft.id, number, draft.entity, draft.kind, draft.family_id, draft.child_id, draft.buyer_name, draft.buyer_address,
            draft.issue_date, draft.due_date, draft.period_from, draft.period_to, draft.total, now()
        ],
    )
    .map_err(|e| match &e {
        rusqlite::Error::SqliteFailure(code, _) if code.code == rusqlite::ErrorCode::ConstraintViolation => {
            AppError::Conflict("za ovo dijete i period ovakav račun je već izdat".into())
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
    for item in &draft.plan_items {
        let changed = tx.execute(
            "UPDATE payment_plan_items SET invoice_id = ?1
             WHERE plan_id = ?2 AND sequence = ?3 AND invoice_id IS NULL
               AND plan_id IN (SELECT p.id FROM payment_plans p JOIN enrolments e ON e.id = p.enrolment_id WHERE e.child_id = ?4)",
            params![draft.id, item.plan_id, item.sequence, draft.child_id],
        )?;
        if changed != 1 {
            return Err(AppError::Conflict("rata plana je već fakturisana ili ne pripada ovom djetetu".into()));
        }
    }
    Ok(number)
}

/// Save (create or replace) a payment plan. A plan with an invoiced instalment can no longer be replaced.
pub fn save_payment_plan(tx: &Transaction, plan: &PaymentPlan) -> AppResult<()> {
    let max = match plan.item_code.as_str() {
        "TUITION" => 12,
        "EXTENDED_STAY" => 10,
        _ => return Err(AppError::Validation("nepoznata stavka plana".into())),
    };
    if plan.instalments < 1 || plan.instalments > max || plan.items.len() as i64 != plan.instalments {
        return Err(AppError::Validation(format!("broj rata mora biti od 1 do {max}")));
    }
    if plan.items.iter().map(|i| i.amount).sum::<i64>() != plan.total {
        return Err(AppError::Validation("zbir rata se ne slaže s ukupnim iznosom plana".into()));
    }
    if plan.items.iter().enumerate().any(|(index, i)| i.sequence != index as i64 + 1 || i.amount < 0) {
        return Err(AppError::Validation("rate moraju biti redom 1..N i nenegativne".into()));
    }
    let enrolment: Option<(String, String, String)> = tx
        .query_row("SELECT child_id, program, school_year FROM enrolments WHERE id = ?1", params![plan.enrolment_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let Some((child_id, program, school_year)) = enrolment else {
        return Err(AppError::NotFound("upis ne postoji".into()));
    };
    if entity_of_program(&program) != "IDSS" || child_id != plan.child_id {
        return Err(AppError::Validation("plan plaćanja postoji samo za upis u školu IDSS".into()));
    }
    // The deadline of the last instalment is a board decision; enforced only once it is entered.
    let deadline = crate::rules::rules_for(tx, &school_year, "IDSS")?.and_then(|r| r.last_instalment_by);
    if let Some(deadline) = deadline.filter(|d| plan.items.iter().any(|i| &i.due_date > d)) {
        return Err(AppError::Validation(format!("prema odluci Školskog odbora posljednja rata dospijeva najkasnije {deadline}")));
    }
    let existing: Option<String> = tx
        .query_row(
            "SELECT id FROM payment_plans WHERE enrolment_id = ?1 AND item_code = ?2",
            params![plan.enrolment_id, plan.item_code],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(old) = existing {
        let invoiced: i64 = tx.query_row(
            "SELECT count(*) FROM payment_plan_items WHERE plan_id = ?1 AND invoice_id IS NOT NULL",
            params![old],
            |r| r.get(0),
        )?;
        if invoiced > 0 {
            return Err(AppError::Conflict("plan ima fakturisane rate i ne može se mijenjati".into()));
        }
        tx.execute("DELETE FROM payment_plan_items WHERE plan_id = ?1", params![old])?;
        tx.execute("DELETE FROM payment_plans WHERE id = ?1", params![old])?;
    }
    tx.execute(
        "INSERT INTO payment_plans(id, enrolment_id, item_code, instalments, total, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![plan.id, plan.enrolment_id, plan.item_code, plan.instalments, plan.total, now()],
    )?;
    for item in &plan.items {
        tx.execute(
            "INSERT INTO payment_plan_items(plan_id, sequence, due_date, amount, invoice_id) VALUES (?1, ?2, ?3, ?4, NULL)",
            params![plan.id, item.sequence, item.due_date, item.amount],
        )?;
    }
    Ok(())
}

/// All payment plans of enrolments in a school year, with their instalments.
pub fn list_payment_plans(conn: &Connection, school_year: &str) -> AppResult<Vec<PaymentPlan>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.enrolment_id, e.child_id, p.item_code, p.instalments, p.total
         FROM payment_plans p JOIN enrolments e ON e.id = p.enrolment_id
         WHERE e.school_year = ?1 ORDER BY e.child_id, p.item_code",
    )?;
    let headers = stmt
        .query_map(params![school_year], |r| {
            Ok(PaymentPlan {
                id: r.get(0)?,
                enrolment_id: r.get(1)?,
                child_id: r.get(2)?,
                item_code: r.get(3)?,
                instalments: r.get(4)?,
                total: r.get(5)?,
                items: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut items = conn.prepare(
        "SELECT sequence, due_date, amount, invoice_id FROM payment_plan_items WHERE plan_id = ?1 ORDER BY sequence",
    )?;
    headers
        .into_iter()
        .map(|mut plan| {
            plan.items = items
                .query_map(params![plan.id], |r| {
                    Ok(PlanItem { sequence: r.get(0)?, due_date: r.get(1)?, amount: r.get(2)?, invoice_id: r.get(3)? })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(plan)
        })
        .collect()
}

const SUMMARY_SELECT: &str = "SELECT i.id, i.number, i.entity, i.kind, i.family_id, f.display_name, i.buyer_name, i.buyer_address,
        i.issue_date, i.due_date, i.period_from, i.period_to, i.total_fenings,
        COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0), i.status,
        COALESCE(i.child_id, ''), COALESCE(c.first_name || ' ' || c.last_name, ''), i.source
 FROM invoices i JOIN families f ON f.id = i.family_id LEFT JOIN children c ON c.id = i.child_id";

fn map_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<InvoiceSummary> {
    Ok(InvoiceSummary {
        id: r.get(0)?,
        number: r.get(1)?,
        entity: r.get(2)?,
        kind: r.get(3)?,
        family_id: r.get(4)?,
        family_name: r.get(5)?,
        child_id: r.get(15)?,
        child_name: r.get(16)?,
        source: r.get(17)?,
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
        // Imported lines (BR-32) have no child/enrolment/program; they are returned as empty strings.
        "SELECT item_code, description, COALESCE(child_id, ''), COALESCE(enrolment_id, ''), COALESCE(program, ''),
                list_amount, board_decision_id, amount
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
            date_of_birth: Some("2022-01-01".into()), residency: "DOMESTIC".into(), citizen_bih: true, residence_ks: true, import_review: false,
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
            child_id: "c1".into(),
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
            plan_items: Vec::new(),
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
        let mut other_child = draft("i5", "2026-12", "2026-12-01", "MONTHLY");
        other_child.lines[0].child_id = "c2".into();
        assert!(matches!(issue_invoice(&tx, &other_child), Err(AppError::Validation(_))));
    }

    #[test]
    fn one_enrolment_fee_invoice_per_child_and_school_year() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        issue_invoice(&tx, &draft("f1", "2026-09", "2026-08-01", "ENROLMENT_FEES")).unwrap();
        assert!(matches!(issue_invoice(&tx, &draft("f2", "2026-09", "2026-08-02", "ENROLMENT_FEES")), Err(AppError::Conflict(_))));
        // a monthly invoice for the same month is a different kind and still allowed
        issue_invoice(&tx, &draft("m1", "2026-09", "2026-09-01", "MONTHLY")).unwrap();
    }

    #[test]
    fn siblings_get_separate_monthly_invoices_br27() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        save_child(&tx, &Child {
            id: "c2".into(), family_id: F.into(), first_name: "B".into(), last_name: "T".into(),
            date_of_birth: Some("2023-01-01".into()), residency: "DOMESTIC".into(), citizen_bih: true, residence_ks: true, import_review: false,
        })
        .unwrap();
        save_enrolment(&tx, &Enrolment {
            id: "e2".into(), child_id: "c2".into(), program: "TODDLERS".into(), school_year: "2026/2027".into(),
            starts_on: "2026-09-01".into(), ends_on: None, status: "ACTIVE".into(),
        })
        .unwrap();
        issue_invoice(&tx, &draft("i1", "2026-10", "2026-10-01", "MONTHLY")).unwrap();
        let mut sibling = draft("i2", "2026-10", "2026-10-01", "MONTHLY");
        sibling.child_id = "c2".into();
        sibling.lines[0].child_id = "c2".into();
        sibling.lines[0].enrolment_id = "e2".into();
        assert_eq!(issue_invoice(&tx, &sibling).unwrap(), "IMH-002/26");
    }

    fn idss_enrolment(conn: &mut Connection) {
        let tx = conn.transaction().unwrap();
        save_enrolment(&tx, &Enrolment {
            id: "e9".into(), child_id: "c1".into(), program: "PRIMARY_1_4".into(), school_year: "2027/2028".into(),
            starts_on: "2027-09-01".into(), ends_on: None, status: "ACTIVE".into(),
        })
        .unwrap();
        tx.commit().unwrap();
    }

    fn idss_plan(id: &str, instalments: i64) -> PaymentPlan {
        let total = 970000;
        let regular = total / instalments;
        PaymentPlan {
            id: id.into(),
            enrolment_id: "e9".into(),
            child_id: "c1".into(),
            item_code: "TUITION".into(),
            instalments,
            total,
            items: (1..=instalments)
                .map(|s| PlanItem {
                    sequence: s,
                    due_date: format!("2027-{:02}-05", 8 + s),
                    amount: if s == instalments { total - regular * (instalments - 1) } else { regular },
                    invoice_id: None,
                })
                .collect(),
        }
    }

    #[test]
    fn payment_plan_round_trip_and_instalment_billed_once() {
        let mut conn = db_with_family();
        idss_enrolment(&mut conn);
        let tx = conn.transaction().unwrap();
        save_payment_plan(&tx, &idss_plan("p1", 4)).unwrap();
        save_payment_plan(&tx, &idss_plan("p2", 2)).unwrap(); // replaces p1 (nothing invoiced yet)
        tx.commit().unwrap();
        let plans = list_payment_plans(&conn, "2027/2028").unwrap();
        assert_eq!(plans, vec![idss_plan("p2", 2)]);

        let tx = conn.transaction().unwrap();
        let mut invoice = draft("i9", "2027-09", "2027-09-01", "INSTALMENT");
        invoice.entity = "IDSS".into();
        invoice.lines[0].program = "PRIMARY_1_4".into();
        invoice.lines[0].enrolment_id = "e9".into();
        invoice.lines[0].amount = 485000;
        invoice.lines[0].list_amount = 485000;
        invoice.total = 485000;
        invoice.plan_items = vec![PlanItemRef { plan_id: "p2".into(), sequence: 1 }];
        assert_eq!(issue_invoice(&tx, &invoice).unwrap(), "IDSS-001/27");
        let mut twice = invoice.clone();
        twice.id = "i10".into();
        assert!(matches!(issue_invoice(&tx, &twice), Err(AppError::Conflict(_))));
        assert!(matches!(save_payment_plan(&tx, &idss_plan("p3", 3)), Err(AppError::Conflict(_))));
        tx.commit().unwrap();
        let plans = list_payment_plans(&conn, "2027/2028").unwrap();
        assert_eq!(plans[0].items[0].invoice_id.as_deref(), Some("i9"));
    }

    #[test]
    fn payment_plan_rejects_bad_sums_counts_and_kindergarten() {
        let mut conn = db_with_family();
        idss_enrolment(&mut conn);
        let tx = conn.transaction().unwrap();
        let mut wrong = idss_plan("p1", 3);
        wrong.total += 1;
        assert!(matches!(save_payment_plan(&tx, &wrong), Err(AppError::Validation(_))));
        let mut stay = idss_plan("p2", 11);
        stay.item_code = "EXTENDED_STAY".into();
        assert!(matches!(save_payment_plan(&tx, &stay), Err(AppError::Validation(_))));
        let mut kindergarten = idss_plan("p3", 2);
        kindergarten.enrolment_id = "e1".into();
        assert!(matches!(save_payment_plan(&tx, &kindergarten), Err(AppError::Validation(_))));
        crate::rules::save_rules(&tx, &crate::rules::BoardBillingRules {
            school_year: "2027/2028".into(), entity: "IDSS".into(), last_instalment_by: Some("2027-11-05".into()),
            breakfast_months: vec![], decision_ref: "ŠO 1/2027".into(),
        })
        .unwrap();
        assert!(matches!(save_payment_plan(&tx, &idss_plan("p4", 4)), Err(AppError::Validation(_))));
        save_payment_plan(&tx, &idss_plan("p5", 3)).unwrap();
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
        assert_eq!(detail.invoice.child_id, "c1");
        assert_eq!(detail.invoice.child_name, "A T");
        assert!(get_invoice(&conn, "missing").unwrap().is_none());
    }
}
