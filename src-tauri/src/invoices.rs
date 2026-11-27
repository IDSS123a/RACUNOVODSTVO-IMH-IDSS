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
    /// Whole quantity 1–999 (migration 013); `amount = quantity × unit price`. Earlier lines are 1.
    #[serde(default = "one")]
    pub quantity: i64,
    /// `kom` or `srv` when entered (manual invoice); None = derived from the item code (F1 / SPEC C5).
    #[serde(default)]
    pub unit: Option<String>,
}

fn one() -> i64 {
    1
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
    /// Basis of a manual invoice (decision, contract, notice — specs/manual-invoice M11); empty for the others.
    #[serde(default)]
    pub reason: String,
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
    /// Effective paid: payments without a reversal, plus credit moved in, minus credit moved out (migration 010).
    pub paid: i64,
    pub status: String,
    /// Sum of the credit notes linked to this invoice (≤ 0); net total = total + credited.
    pub credited: i64,
    /// For a credit note: the invoice it cancels.
    pub credits_invoice_id: Option<String>,
    /// For a credit note: the reason.
    pub reason: String,
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
    /// Set when the payment was reversed by a counter-entry (S4); it then no longer counts.
    #[serde(default)]
    pub reversed_on: Option<String>,
    #[serde(default)]
    pub reversal_reason: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceDetail {
    pub invoice: InvoiceSummary,
    pub lines: Vec<InvoiceLine>,
    pub payments: Vec<Payment>,
    /// Credit notes that cancel this invoice (migration 010), oldest first.
    pub credit_notes: Vec<CreditNoteRef>,
    /// Already credited per original line position (≤ 0), for the remaining creditable amount (S2).
    pub credited_lines: Vec<crate::credit_notes::CreditNoteLine>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreditNoteRef {
    pub id: String,
    pub number: String,
    pub issue_date: String,
    pub total: i64,
    pub reason: String,
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

/// Highest amount of one line, one invoice or one payment, in fenings: 100.000,00 KM. An invoice of 10 trillion KM
/// was issued from a mistyped price (Director, 2026-11-27); the forms check the same (`MAX_AMOUNT` in money.ts).
pub const MAX_AMOUNT: i64 = 10_000_000;

/// Issue an invoice: validate, number, insert header and lines. Returns the assigned number.
pub fn issue_invoice(tx: &Transaction, draft: &InvoiceDraft) -> AppResult<String> {
    if draft.lines.is_empty() {
        return Err(AppError::Validation("račun mora imati barem jednu stavku".into()));
    }
    if draft.total > MAX_AMOUNT || draft.lines.iter().any(|l| l.amount.abs() > MAX_AMOUNT || l.list_amount.abs() > MAX_AMOUNT) {
        return Err(AppError::Validation("iznos stavke ili računa je veći od 100.000,00 KM — provjerite cijenu".into()));
    }
    let line_sum: i64 = draft.lines.iter().map(|l| l.amount).sum();
    if line_sum != draft.total {
        return Err(AppError::Validation("zbir stavki se ne slaže s ukupnim iznosom".into()));
    }
    // A line without a program is a service for a child not enrolled in the institution (manual invoice only).
    if draft.lines.iter().any(|l| !l.program.is_empty() && entity_of_program(&l.program) != draft.entity) {
        return Err(AppError::Validation("račun ne smije miješati stavke IMH i IDSS".into()));
    }
    if draft.lines.iter().any(|l| l.child_id != draft.child_id) {
        return Err(AppError::Validation("račun se izdaje za jedno dijete — sve stavke moraju biti za to dijete".into()));
    }
    validate_lines(draft)?;
    if draft.kind == "OTHER" && draft.lines.iter().any(|l| !l.enrolment_id.is_empty()) {
        return Err(AppError::Validation("faktura za ostale usluge se ne veže za upis".into()));
    }
    ensure_one_time_not_billed(tx, draft)?;
    ensure_not_billed_twice(tx, draft)?;
    let number = next_number(tx, &draft.entity, &draft.issue_date)?;
    tx.execute(
        "INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, buyer_address, issue_date, due_date,
                              period_from, period_to, total_fenings, status, created_at, reason)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'ISSUED', ?14, ?15)",
        params![
            draft.id, number, draft.entity, draft.kind, draft.family_id, draft.child_id, draft.buyer_name, draft.buyer_address,
            draft.issue_date, draft.due_date, draft.period_from, draft.period_to, draft.total, now(), draft.reason.trim()
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
                                       list_amount, board_decision_id, amount, quantity, unit)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                format!("{}-{}", draft.id, index + 1), draft.id, (index + 1) as i64, line.item_code, line.description,
                line.child_id, non_empty(&line.enrolment_id), non_empty(&line.program), line.list_amount, line.board_decision_id,
                line.amount, line.quantity, line.unit
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

fn non_empty(text: &str) -> Option<&str> {
    if text.is_empty() { None } else { Some(text) }
}

/// One-time items (BR-9, BR-10), billed at most once per enrolment. The two enrolment-fee codes are one item.
fn one_time_group(item_code: &str) -> Option<&'static str> {
    match item_code {
        "ENROLMENT_FEE" | "ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL" => Some("ENROLMENT_FEE"),
        "MATERIALS" => Some("MATERIALS"),
        "DEPOSIT" => Some("DEPOSIT"),
        _ => None,
    }
}

/// Line rules of every issued invoice (specs/one-invoice-per-child, Director 2026-11-21):
/// - a service outside the price list (`OTHER`) may be on the child's monthly invoice or on a manual invoice, never on
///   an enrolment-fee invoice; it is entered at its amount (no discount without a board-decision record, BR-7), with a
///   unit, and the invoice carries its basis;
/// - a manual invoice (kind `OTHER`) has only such lines and a total above zero; only it may have lines without a
///   program (a child not enrolled in the institution).
fn validate_lines(draft: &InvoiceDraft) -> AppResult<()> {
    for (index, line) in draft.lines.iter().enumerate() {
        let row = index + 1;
        if !(1..=999).contains(&line.quantity) {
            return Err(AppError::Validation(format!("red {row}: količina mora biti cijeli broj od 1 do 999")));
        }
        if line.amount % line.quantity != 0 || line.list_amount % line.quantity != 0 {
            return Err(AppError::Validation(format!("red {row}: iznos stavke mora biti količina × cijena")));
        }
        // unit of measure: proposed (srv, kom, sedm. …) or any other short unit — letters and dots, up to 10 characters
        if line.unit.as_deref().is_some_and(|u| {
            let n = u.chars().count();
            n == 0 || n > 10 || !u.chars().next().is_some_and(char::is_alphabetic) || !u.chars().all(|c| c.is_alphabetic() || c == '.' || c == ' ')
        }) {
            return Err(AppError::Validation(format!("red {row}: jedinica mjere je kratka riječ (npr. srv, kom, sedm.), najviše 10 slova")));
        }
        if line.program.is_empty() && (draft.kind != "OTHER" || line.item_code != "OTHER" || !line.enrolment_id.is_empty()) {
            return Err(AppError::Validation(format!("red {row}: stavka bez upisa postoji samo na ručnom računu")));
        }
    }
    let manual_lines = draft.lines.iter().filter(|l| l.item_code == "OTHER").count();
    if manual_lines > 0 && !matches!(draft.kind.as_str(), "OTHER" | "MONTHLY" | "INSTALMENT") {
        return Err(AppError::Validation("stavka van cjenovnika ide na mjesečni ili ručni račun".into()));
    }
    if draft.kind == "OTHER" && manual_lines != draft.lines.len() {
        return Err(AppError::Validation(
            "ručni račun sadrži samo usluge van cjenovnika — stavke cjenovnika idu na mjesečni račun djeteta".into(),
        ));
    }
    if manual_lines == 0 {
        return Ok(());
    }
    if draft.reason.trim().is_empty() {
        return Err(AppError::Validation("unesite osnov za uslugu van cjenovnika (odluka, ugovor ili obavijest)".into()));
    }
    for (index, line) in draft.lines.iter().enumerate().filter(|(_, l)| l.item_code == "OTHER") {
        let row = index + 1;
        if line.description.trim().is_empty() {
            return Err(AppError::Validation(format!("red {row}: unesite naziv usluge/stavke")));
        }
        if line.amount != line.list_amount || line.board_decision_id.is_some() {
            return Err(AppError::Validation(format!("red {row}: rabat na usluzi van cjenovnika nije dozvoljen bez odluke odbora")));
        }
        if line.unit.is_none() {
            return Err(AppError::Validation(format!("red {row}: odaberite jedinicu mjere")));
        }
    }
    if draft.kind != "OTHER" {
        return Ok(());
    }
    if draft.total <= 0 {
        return Err(AppError::Validation("ukupan iznos računa mora biti veći od 0 KM".into()));
    }
    Ok(())
}

/// Enrolment fee, materials and deposit are billed at most once per enrolment, also across invoices
/// (one invoice per child carries them when they fall due — Director, 2026-11-21).
fn ensure_one_time_not_billed(tx: &Transaction, draft: &InvoiceDraft) -> AppResult<()> {
    let mut seen = std::collections::HashSet::new();
    for line in draft.lines.iter().filter(|l| !l.enrolment_id.is_empty()) {
        let Some(group) = one_time_group(&line.item_code) else { continue };
        if !seen.insert((line.enrolment_id.as_str(), group)) {
            return Err(AppError::Validation("ista jednokratna stavka je dva puta na računu".into()));
        }
        let billed: i64 = tx.query_row(
            "SELECT count(*) FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
             WHERE l.enrolment_id = ?1 AND i.status = 'ISSUED' AND i.kind <> 'CREDIT_NOTE'
               AND (CASE WHEN l.item_code IN ('ENROLMENT_FEE', 'ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL') THEN 'ENROLMENT_FEE'
                         ELSE l.item_code END) = ?2",
            params![line.enrolment_id, group],
            |r| r.get(0),
        )?;
        if billed > 0 {
            return Err(AppError::Conflict(format!("„{}“ je za ovaj upis već fakturisan", line.description)));
        }
    }
    Ok(())
}

/// Nothing is invoiced twice to the same child for the same period (Director, 2026-11-22: „isto dijete, ista usluga,
/// isti period — sistem to dozvoljava. Fundamentalna greška.“). Checked here, in the issuing transaction, so no
/// screen can bypass it:
/// - one monthly invoice per child, institution and month — IMH `MONTHLY` and IDSS `INSTALMENT` alike (the unique
///   index covered only `MONTHLY`);
/// - a service outside the price list (`OTHER` line) is not billed again to the child for the same month when an
///   issued invoice already has a line with the same text (case and spacing ignored) — on a manual or a monthly invoice.
/// A credited invoice (status `CANCELLED`) no longer counts, so a corrected invoice can be issued.
fn ensure_not_billed_twice(tx: &Transaction, draft: &InvoiceDraft) -> AppResult<()> {
    if matches!(draft.kind.as_str(), "MONTHLY" | "INSTALMENT") {
        let existing: Option<String> = tx
            .query_row(
                "SELECT number FROM invoices WHERE child_id = ?1 AND entity = ?2 AND period_from = ?3
                   AND kind IN ('MONTHLY', 'INSTALMENT') AND status = 'ISSUED' LIMIT 1",
                params![draft.child_id, draft.entity, draft.period_from],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(number) = existing {
            return Err(AppError::Conflict(format!("za ovo dijete je mjesečni račun za taj mjesec već izdat ({number})")));
        }
    }
    let mut seen = std::collections::HashSet::new();
    let billed = billed_services(tx, &draft.entity, &draft.period_from)?;
    for line in draft.lines.iter().filter(|l| l.item_code == "OTHER") {
        let key = service_key(&line.description);
        if !seen.insert(key.clone()) {
            return Err(AppError::Validation(format!("„{}“ je dva puta na istom računu", line.description.trim())));
        }
        if let Some(found) = billed.iter().find(|b| b.child_id == draft.child_id && service_key(&b.description) == key) {
            return Err(AppError::Conflict(format!(
                "„{}“ je ovom djetetu za taj mjesec već fakturisano ({})",
                line.description.trim(),
                found.invoice_number
            )));
        }
    }
    Ok(())
}

/// Text of a service for comparison: lower case, single spaces.
pub fn service_key(description: &str) -> String {
    description.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// A service outside the price list already on an issued invoice of the month.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BilledService {
    pub child_id: String,
    pub description: String,
    pub invoice_number: String,
}

/// Services outside the price list (`OTHER` lines) on issued invoices of an institution and month (`period_from`),
/// so the screens can say before creating that a child already has it.
pub fn billed_services(conn: &Connection, entity: &str, period_from: &str) -> AppResult<Vec<BilledService>> {
    let mut stmt = conn.prepare(
        "SELECT i.child_id, l.description, i.number FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
         WHERE i.entity = ?1 AND i.period_from = ?2 AND i.status = 'ISSUED' AND i.kind <> 'CREDIT_NOTE'
           AND l.item_code = 'OTHER' AND i.child_id IS NOT NULL
         ORDER BY i.number",
    )?;
    let rows = stmt.query_map(params![entity, period_from], |r| Ok(BilledService { child_id: r.get(0)?, description: r.get(1)?, invoice_number: r.get(2)? }))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// A one-time item already on an issued invoice (specs/one-invoice-per-child), so the monthly preview does not
/// propose it again.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BilledOneTime {
    /// The enrolment it was billed for; None for an imported invoice of the old workbook.
    pub enrolment_id: Option<String>,
    pub child_id: String,
    pub entity: String,
    pub item_code: String,
    pub invoice_number: String,
    pub issue_date: String,
}

/// One-time items billed for the enrolments of a school year, plus those on imported invoices issued from March of
/// the year before its start (the old workbook billed the next year's enrolment in spring and summer; they carry no
/// enrolment, so the preview shows them for the operator to judge).
pub fn billed_one_time(conn: &Connection, school_year: &str) -> AppResult<Vec<BilledOneTime>> {
    let start: i64 = school_year.get(0..4).and_then(|y| y.parse().ok()).ok_or_else(|| AppError::Validation("neispravna školska godina".into()))?;
    let window_from = format!("{start}-03-01");
    let window_to = format!("{}-08-31", start + 1);
    let mut stmt = conn.prepare(
        "SELECT l.enrolment_id, i.child_id, i.entity, l.item_code, i.number, i.issue_date
         FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
         LEFT JOIN enrolments e ON e.id = l.enrolment_id
         WHERE i.status = 'ISSUED' AND i.kind <> 'CREDIT_NOTE' AND i.child_id IS NOT NULL
           AND l.item_code IN ('ENROLMENT_FEE', 'ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL', 'MATERIALS', 'DEPOSIT')
           AND (e.school_year = ?1 OR (l.enrolment_id IS NULL AND i.source = 'LEGACY' AND i.issue_date BETWEEN ?2 AND ?3))
         ORDER BY i.issue_date",
    )?;
    let rows = stmt.query_map(params![school_year, window_from, window_to], |r| {
        Ok(BilledOneTime {
            enrolment_id: r.get(0)?,
            child_id: r.get(1)?,
            entity: r.get(2)?,
            item_code: r.get(3)?,
            invoice_number: r.get(4)?,
            issue_date: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
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
        __PAID__, i.status,
        COALESCE(i.child_id, ''), COALESCE(c.first_name || ' ' || c.last_name, ''), i.source,
        COALESCE((SELECT sum(cn.total_fenings) FROM invoices cn WHERE cn.credits_invoice_id = i.id), 0),
        i.credits_invoice_id, i.reason
 FROM invoices i JOIN families f ON f.id = i.family_id LEFT JOIN children c ON c.id = i.child_id";

/// The summary query with the single effective-paid definition (credit_notes::PAID_SQL, M-7).
fn summary_select() -> String {
    SUMMARY_SELECT.replace("__PAID__", crate::credit_notes::PAID_SQL)
}

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
        credited: r.get(18)?,
        credits_invoice_id: r.get(19)?,
        reason: r.get(20)?,
    })
}

/// Invoices, optionally filtered by entity and by month ("YYYY-MM" of the period start), newest first.
pub fn list_invoices(conn: &Connection, entity: Option<&str>, month: Option<&str>) -> AppResult<Vec<InvoiceSummary>> {
    let sql = format!(
        "{} WHERE (?1 IS NULL OR i.entity = ?1) AND (?2 IS NULL OR substr(i.period_from, 1, 7) = ?2)
         ORDER BY i.issue_date DESC, i.number DESC",
        summary_select()
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![entity, month], map_summary)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_invoice(conn: &Connection, invoice_id: &str) -> AppResult<Option<InvoiceDetail>> {
    let sql = format!("{} WHERE i.id = ?1", summary_select());
    let Some(invoice) = conn.query_row(&sql, params![invoice_id], map_summary).optional()? else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        // Imported lines (BR-32) have no child/enrolment/program; they are returned as empty strings.
        "SELECT item_code, description, COALESCE(child_id, ''), COALESCE(enrolment_id, ''), COALESCE(program, ''),
                list_amount, board_decision_id, amount, quantity, unit
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
                quantity: r.get(8)?,
                unit: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.invoice_id, p.paid_on, p.amount, p.payer_name, p.reference, p.note, r.reversed_on, r.reason
         FROM payments p LEFT JOIN payment_reversals r ON r.payment_id = p.id
         WHERE p.invoice_id = ?1 ORDER BY p.paid_on, p.created_at",
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
                reversed_on: r.get(7)?,
                reversal_reason: r.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT id, number, issue_date, total_fenings, reason FROM invoices WHERE credits_invoice_id = ?1 ORDER BY issue_date, number",
    )?;
    let credit_notes = stmt
        .query_map(params![invoice_id], |r| {
            Ok(CreditNoteRef { id: r.get(0)?, number: r.get(1)?, issue_date: r.get(2)?, total: r.get(3)?, reason: r.get(4)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT l.credits_position, sum(l.amount) FROM invoice_lines l JOIN invoices cn ON cn.id = l.invoice_id
         WHERE cn.credits_invoice_id = ?1 AND l.credits_position IS NOT NULL GROUP BY l.credits_position ORDER BY l.credits_position",
    )?;
    let credited_lines = stmt
        .query_map(params![invoice_id], |r| Ok(crate::credit_notes::CreditNoteLine { position: r.get(0)?, amount: r.get(1)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(InvoiceDetail { invoice, lines, payments, credit_notes, credited_lines }))
}

/// Book a payment against an issued invoice. Overpayments are allowed and kept as credit.
pub fn record_payment(tx: &Transaction, payment: &Payment) -> AppResult<()> {
    let found: Option<(String, String)> = tx
        .query_row("SELECT status, kind FROM invoices WHERE id = ?1", params![payment.invoice_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    match found.as_ref().map(|(status, kind)| (status.as_str(), kind.as_str())) {
        None => return Err(AppError::NotFound("račun ne postoji".into())),
        Some((_, "CREDIT_NOTE")) => return Err(AppError::Validation("uplata se knjiži na račun, ne na knjižno odobrenje".into())),
        Some(("ISSUED", _)) => {}
        Some(_) => return Err(AppError::Conflict("uplata se ne može knjižiti na storniran račun".into())),
    }
    if payment.amount <= 0 {
        return Err(AppError::Validation("iznos uplate mora biti veći od nule".into()));
    }
    if payment.amount > MAX_AMOUNT {
        return Err(AppError::Validation("iznos uplate je veći od 100.000,00 KM — provjerite iznos".into()));
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
            date_of_birth: Some("2024-01-01".into()), residency: "DOMESTIC".into(), citizen_bih: true, residence_ks: true, import_review: false,
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
                quantity: 1, unit: None,
            }],
            total: 71000,
            reason: String::new(),
            plan_items: Vec::new(),
        }
    }

    /// A manual invoice for a child NOT enrolled in IMH that school year (c1 is enrolled only in 2026/2027).
    fn manual(id: &str) -> InvoiceDraft {
        let mut d = draft(id, "2027-09", "2027-09-01", "OTHER");
        d.reason = "Obavijest o ljetnoj školi 2027".into();
        d.lines = vec![InvoiceLine {
            item_code: "OTHER".into(), description: "Ljetna škola — sedmica".into(), child_id: "c1".into(),
            enrolment_id: String::new(), program: String::new(), list_amount: 3 * 15050, board_decision_id: None,
            amount: 3 * 15050, quantity: 3, unit: Some("srv".into()),
        }];
        d.total = 3 * 15050;
        d
    }

    /// Director, 2026-11-22: the same service is never billed twice to the same child for the same month — whatever
    /// the case or spacing of its text, on a manual or a monthly invoice; another service, another month or a credited
    /// invoice is fine. A second monthly invoice (IMH MONTHLY or IDSS INSTALMENT) for the same month is refused.
    #[test]
    fn nothing_is_billed_twice_to_the_same_child_for_the_same_month() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        let first = issue_invoice(&tx, &manual("m1")).unwrap();
        tx.commit().unwrap();

        let same = |id: &str, text: &str| {
            let mut d = manual(id);
            d.lines[0].description = text.into();
            d
        };
        for text in ["Ljetna škola — sedmica", "  ljetna   ŠKOLA — sedmica "] {
            let tx = conn.transaction().unwrap();
            let err = issue_invoice(&tx, &same("dup", text)).unwrap_err();
            assert!(matches!(err, AppError::Conflict(ref m) if m.contains(&first)), "{text:?}: {err:?}");
        }
        // two equal lines on one invoice
        let tx = conn.transaction().unwrap();
        let mut twice = manual("m-twice");
        twice.lines.push(twice.lines[0].clone());
        twice.total *= 2;
        assert!(issue_invoice(&tx, &twice).is_err());
        drop(tx);

        // another service, or the same service in another month, is fine
        let tx = conn.transaction().unwrap();
        assert!(issue_invoice(&tx, &same("m2", "Ljetna škola 2027 — 2. sedmica")).is_ok());
        let mut august = manual("m3");
        august.period_from = "2027-08-01".into();
        august.period_to = "2027-08-31".into();
        assert!(issue_invoice(&tx, &august).is_ok());
        tx.commit().unwrap();

        // the same service on the child's monthly invoice of that month is a duplicate too
        let tx = conn.transaction().unwrap();
        let mut monthly = draft("i-sep", "2027-09", "2027-09-01", "MONTHLY");
        monthly.lines.push(InvoiceLine {
            item_code: "OTHER".into(), description: "Ljetna škola — sedmica".into(), child_id: "c1".into(), enrolment_id: "e1".into(),
            program: "TODDLERS".into(), list_amount: 2000, board_decision_id: None, amount: 2000, quantity: 1, unit: Some("srv".into()),
        });
        monthly.total += 2000;
        monthly.reason = "Obavijest".into();
        assert!(issue_invoice(&tx, &monthly).is_err());
        drop(tx);

        // a credited (cancelled) invoice no longer counts: the corrected one can be issued
        conn.execute("UPDATE invoices SET status = 'CANCELLED' WHERE id = 'm1'", []).unwrap();
        let tx = conn.transaction().unwrap();
        assert!(issue_invoice(&tx, &manual("m4")).is_ok());
        tx.commit().unwrap();

        // one monthly invoice per child and month, IMH MONTHLY and IDSS INSTALMENT alike
        let tx = conn.transaction().unwrap();
        assert!(issue_invoice(&tx, &draft("i-oct", "2026-10", "2026-10-01", "MONTHLY")).is_ok());
        let mut second = draft("i-oct-2", "2026-10", "2026-10-01", "INSTALMENT");
        second.lines[0].item_code = "BREAKFAST".into();
        assert!(matches!(issue_invoice(&tx, &second), Err(AppError::Conflict(_))));
    }

    /// Director, 2026-11-27: an invoice of 10 trillion KM was issued from a mistyped price. A line, an invoice or a
    /// payment above 100.000,00 KM is refused; exactly 100.000,00 KM is fine.
    #[test]
    fn no_amount_above_one_hundred_thousand_km() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        let mut absurd = manual("m-absurd");
        absurd.lines[0].quantity = 1;
        absurd.lines[0].amount = 1_000_000_000_000_000;
        absurd.lines[0].list_amount = 1_000_000_000_000_000;
        absurd.total = 1_000_000_000_000_000;
        assert!(matches!(issue_invoice(&tx, &absurd), Err(AppError::Validation(_))));
        let mut limit = manual("m-limit");
        limit.lines[0].quantity = 1;
        limit.lines[0].amount = MAX_AMOUNT;
        limit.lines[0].list_amount = MAX_AMOUNT;
        limit.total = MAX_AMOUNT;
        assert!(issue_invoice(&tx, &limit).is_ok());
        let pay = |id: &str, amount: i64| Payment {
            id: id.into(), invoice_id: "m-limit".into(), paid_on: "2027-09-02".into(), amount, payer_name: "Majka".into(),
            reference: String::new(), note: String::new(), reversed_on: None, reversal_reason: None,
        };
        assert!(record_payment(&tx, &pay("p1", MAX_AMOUNT + 1)).is_err());
        assert!(record_payment(&tx, &pay("p2", MAX_AMOUNT)).is_ok());
    }

    /// specs/manual-invoice: a manual invoice is numbered in its institution's series, keeps quantity, unit and basis.
    #[test]
    fn manual_invoice_round_trips_quantity_unit_and_basis() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        assert_eq!(issue_invoice(&tx, &manual("m1")).unwrap(), "IMH-001/27");
        tx.commit().unwrap();
        let detail = get_invoice(&conn, "m1").unwrap().unwrap();
        assert_eq!(detail.invoice.kind, "OTHER");
        assert_eq!(detail.invoice.reason, "Obavijest o ljetnoj školi 2027");
        assert_eq!((detail.lines[0].quantity, detail.lines[0].unit.as_deref(), detail.lines[0].amount), (3, Some("srv"), 45150));
        // a manual invoice does not block the monthly invoice of the same child and month
        let tx = conn.transaction().unwrap();
        assert!(issue_invoice(&tx, &draft("i1", "2027-09", "2027-09-01", "MONTHLY")).is_ok());
    }

    /// Director, 2026-11-21: a manual invoice only for a child not regularly enrolled; an enrolled child's extra
    /// service goes on its monthly invoice, with the basis.
    #[test]
    fn enrolled_child_gets_extra_services_on_the_monthly_invoice_not_a_manual_one() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        let mut enrolled = manual("m2");
        enrolled.period_from = "2027-07-01".into();
        enrolled.period_to = "2027-07-31".into();
        enrolled.issue_date = "2027-07-01".into();
        enrolled.due_date = "2027-07-05".into();
        // Director 2026-11-21 (guided flow): other services may be invoiced to an enrolled child too, on their own invoice
        assert!(issue_invoice(&tx, &enrolled).is_ok());

        let extra = InvoiceLine {
            item_code: "OTHER".into(), description: "Izlet".into(), child_id: "c1".into(), enrolment_id: "e1".into(),
            program: "TODDLERS".into(), list_amount: 2000, board_decision_id: None, amount: 2000, quantity: 1, unit: Some("kom".into()),
        };
        let mut monthly = draft("i7", "2027-07", "2027-07-01", "MONTHLY");
        monthly.lines.push(extra.clone());
        monthly.total = 73000;
        assert!(matches!(issue_invoice(&tx, &monthly), Err(AppError::Validation(_))), "an extra service needs its basis");
        monthly.reason = "Obavijest o izletu".into();
        assert!(issue_invoice(&tx, &monthly).is_ok());
        // never on an enrolment-fee invoice, and never without a program outside a manual invoice
        let mut fees = draft("f9", "2027-07", "2027-07-01", "ENROLMENT_FEES");
        fees.lines = vec![extra.clone()];
        fees.total = 2000;
        fees.reason = "x".into();
        assert!(matches!(issue_invoice(&tx, &fees), Err(AppError::Validation(_))));
        let mut no_program = draft("i8", "2027-08", "2027-08-01", "MONTHLY");
        no_program.lines[0].program = String::new();
        assert!(matches!(issue_invoice(&tx, &no_program), Err(AppError::Validation(_))));
    }

    /// One invoice per child: enrolment fee, materials and deposit at most once per enrolment, across invoices, and
    /// the preview learns what is billed. A cancelled invoice frees the item again (full credit note, S6).
    #[test]
    fn one_time_items_are_billed_once_per_enrolment() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        let fee = |code: &str, amount: i64| InvoiceLine {
            item_code: code.into(), description: format!("{code} 2026/2027"), child_id: "c1".into(), enrolment_id: "e1".into(),
            program: "TODDLERS".into(), list_amount: amount, board_decision_id: None, amount, quantity: 1, unit: None,
        };
        let mut september = draft("s1", "2026-09", "2026-08-25", "MONTHLY");
        september.lines.push(fee("ENROLMENT_FEE", 20000));
        september.lines.push(fee("MATERIALS", 30000));
        september.total = 71000 + 50000;
        issue_invoice(&tx, &september).unwrap();
        let mut october = draft("s2", "2026-10", "2026-10-01", "MONTHLY");
        october.lines.push(fee("ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL", 50000));
        october.total = 121000;
        assert!(matches!(issue_invoice(&tx, &october), Err(AppError::Conflict(_))), "the two enrolment-fee codes are one item");
        let mut twice = draft("s3", "2026-11", "2026-11-01", "MONTHLY");
        twice.lines.push(fee("DEPOSIT", 71000));
        twice.lines.push(fee("DEPOSIT", 71000));
        twice.total = 213000;
        assert!(matches!(issue_invoice(&tx, &twice), Err(AppError::Validation(_))));
        let mut deposit = draft("s4", "2026-11", "2026-11-01", "MONTHLY");
        deposit.lines.push(fee("DEPOSIT", 71000));
        deposit.total = 142000;
        issue_invoice(&tx, &deposit).unwrap();
        tx.commit().unwrap();

        let billed = billed_one_time(&conn, "2026/2027").unwrap();
        assert_eq!(billed.iter().map(|b| b.item_code.as_str()).collect::<Vec<_>>(), vec!["ENROLMENT_FEE", "MATERIALS", "DEPOSIT"]);
        assert!(billed.iter().all(|b| b.enrolment_id.as_deref() == Some("e1") && b.child_id == "c1"));
        assert!(billed_one_time(&conn, "2027/2028").unwrap().is_empty());

        conn.execute("UPDATE invoices SET status = 'CANCELLED' WHERE id = 's4'", []).unwrap();
        assert_eq!(billed_one_time(&conn, "2026/2027").unwrap().len(), 2, "a cancelled invoice no longer counts");
    }

    /// Every rule of the manual invoice is enforced here too, not only in the form (defence in depth).
    #[test]
    fn manual_invoice_rejections() {
        let mut conn = db_with_family();
        let tx = conn.transaction().unwrap();
        let rejected = |change: &dyn Fn(&mut InvoiceDraft)| {
            let mut d = manual("bad");
            change(&mut d);
            matches!(issue_invoice(&tx, &d), Err(AppError::Validation(_)))
        };
        assert!(rejected(&|d| d.reason = "  ".into()), "basis required");
        assert!(rejected(&|d| d.lines[0].quantity = 0), "quantity ≥ 1");
        assert!(rejected(&|d| d.lines[0].quantity = 1000), "quantity ≤ 999");
        assert!(rejected(&|d| d.lines[0].quantity = 4), "amount = quantity × unit price");
        assert!(rejected(&|d| d.lines[0].unit = None), "unit required");
        assert!(rejected(&|d| d.lines[0].unit = Some(String::new())), "unit not empty");
        assert!(rejected(&|d| d.lines[0].unit = Some("12".into())), "unit is a word");
        assert!(rejected(&|d| d.lines[0].unit = Some("sedmicaaaaa".into())), "unit up to 10 characters");
        assert!(rejected(&|d| d.lines[0].description = " ".into()), "description required");
        assert!(rejected(&|d| { d.lines[0].amount = 30000; d.total = 30000; }), "no discount without a board decision");
        assert!(rejected(&|d| d.lines[0].board_decision_id = Some("x".into())), "no board decision on a manual line");
        assert!(rejected(&|d| { d.lines[0].item_code = "TUITION".into(); }), "price-list items go through their flows");
        assert!(rejected(&|d| { d.lines[0].list_amount = 0; d.lines[0].amount = 0; d.total = 0; }), "total above zero");
        assert!(rejected(&|d| d.lines[0].enrolment_id = "e1".into()), "a manual line is not tied to an enrolment");
        let mut monthly = draft("bad2", "2027-07", "2027-07-01", "MONTHLY");
        monthly.lines[0].item_code = "OTHER".into();
        monthly.lines[0].unit = Some("srv".into());
        assert!(matches!(issue_invoice(&tx, &monthly), Err(AppError::Validation(_))), "an extra service on a monthly invoice needs a basis");
        assert_eq!(next_number(&tx, "IMH", "2027-07-01").unwrap(), "IMH-001/27", "no number was used by a rejected draft");
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
            // 150 different services (the same service twice for the same child and month is refused)
            let mut invoice = manual(&format!("x{n}"));
            invoice.lines[0].description = format!("Radionica {n}");
            let number = issue_invoice(&tx, &invoice).unwrap();
            assert_eq!(number, format!("IMH-{n:03}/27"));
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
        // these tests are about IDSS plans, not the age: the test child (a toddler) gets no date of birth here
        tx.execute("UPDATE children SET date_of_birth = NULL WHERE id = 'c1'", []).unwrap();
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
            reversed_on: None, reversal_reason: None,
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
