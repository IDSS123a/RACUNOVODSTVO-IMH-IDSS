//! Storno, credit notes and payment correction (specs/storno-credit-notes, Director S1–S6, migration 010).
//! Nothing is deleted or changed in place: credit notes, payment reversals and credit movements are
//! appended records. The effective balance of an invoice has ONE definition, `NET_SQL` / `PAID_SQL`,
//! used by the invoice summary and by every check here (M-7); the TypeScript domain mirrors it.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::repository::now;

/// Longest reason / note accepted (characters).
const TEXT_MAX: usize = 500;

/// Net total of invoice `i`: its total plus every credit note linked to it (credit notes are negative).
pub const NET_SQL: &str =
    "(i.total_fenings + COALESCE((SELECT sum(cn.total_fenings) FROM invoices cn WHERE cn.credits_invoice_id = i.id), 0))";

/// Effective paid on invoice `i`: payments without a reversal, plus credit moved in, minus credit moved out
/// (S3, existing records), plus prepayment used on it, minus its excess used elsewhere or refunded (migration 016;
/// a reversed use does not count).
pub const PAID_SQL: &str = "(COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id
        AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)), 0)
   + COALESCE((SELECT sum(m.amount) FROM credit_movements m WHERE m.to_invoice_id = i.id), 0)
   - COALESCE((SELECT sum(m.amount) FROM credit_movements m WHERE m.from_invoice_id = i.id), 0)
   + COALESCE((SELECT sum(u.amount) FROM prepayment_uses u WHERE u.invoice_id = i.id
        AND NOT EXISTS (SELECT 1 FROM prepayment_use_reversals ur WHERE ur.use_id = u.id)), 0)
   - COALESCE((SELECT sum(u.amount) FROM prepayment_uses u WHERE u.source_invoice_id = i.id
        AND NOT EXISTS (SELECT 1 FROM prepayment_use_reversals ur WHERE ur.use_id = u.id)), 0))";

/// Prepayment applied to invoice `i` — the line „Umanjeno za primljenu pretplatu“ on its PDF (Q3):
/// credit moved in (S3) plus prepayment uses on it that are not reversed.
pub const APPLIED_PREPAYMENT_SQL: &str = "(COALESCE((SELECT sum(m.amount) FROM credit_movements m WHERE m.to_invoice_id = i.id), 0)
   + COALESCE((SELECT sum(u.amount) FROM prepayment_uses u WHERE u.invoice_id = i.id
        AND NOT EXISTS (SELECT 1 FROM prepayment_use_reversals ur WHERE ur.use_id = u.id)), 0))";

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreditNoteLine {
    /// Position of the credited line on the original invoice.
    pub position: i64,
    /// Credited amount in fenings, negative.
    pub amount: i64,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreditNoteDraft {
    pub id: String,
    pub invoice_id: String,
    pub issue_date: String,
    pub reason: String,
    pub lines: Vec<CreditNoteLine>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IssuedCreditNote {
    pub number: String,
    /// The original invoice is now fully cancelled (net 0) and may be re-issued (S6).
    pub cancelled: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FamilyCredit {
    pub invoice_id: String,
    pub number: String,
    pub entity: String,
    pub credit: i64,
}

/// (net, effective paid) of one invoice.
pub fn balance(conn: &Connection, invoice_id: &str) -> AppResult<(i64, i64)> {
    Ok(conn.query_row(&format!("SELECT {NET_SQL}, {PAID_SQL} FROM invoices i WHERE i.id = ?1"), params![invoice_id], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })?)
}

pub(crate) fn required_text(value: &str, what: &str) -> AppResult<String> {
    let text = value.trim();
    if text.is_empty() {
        return Err(AppError::Validation(format!("upišite {what}")));
    }
    if text.chars().count() > TEXT_MAX {
        return Err(AppError::Validation(format!("{what}: najviše {TEXT_MAX} znakova")));
    }
    Ok(text.to_string())
}

pub(crate) fn valid_date(value: &str) -> AppResult<()> {
    let ok = value.len() == 10
        && value.as_bytes().iter().enumerate().all(|(i, b)| if i == 4 || i == 7 { *b == b'-' } else { b.is_ascii_digit() });
    if ok { Ok(()) } else { Err(AppError::Validation("neispravan datum".into())) }
}

struct Original {
    number: String,
    entity: String,
    kind: String,
    status: String,
    family_id: String,
    child_id: Option<String>,
    buyer_name: String,
    buyer_address: String,
    issue_date: String,
    period_from: String,
    period_to: String,
}

fn original(tx: &Transaction, invoice_id: &str) -> AppResult<Original> {
    tx.query_row(
        "SELECT number, entity, kind, status, family_id, child_id, buyer_name, buyer_address, issue_date, period_from, period_to
         FROM invoices WHERE id = ?1",
        params![invoice_id],
        |r| {
            Ok(Original {
                number: r.get(0)?,
                entity: r.get(1)?,
                kind: r.get(2)?,
                status: r.get(3)?,
                family_id: r.get(4)?,
                child_id: r.get(5)?,
                buyer_name: r.get(6)?,
                buyer_address: r.get(7)?,
                issue_date: r.get(8)?,
                period_from: r.get(9)?,
                period_to: r.get(10)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound("račun ne postoji".into()))
}

/// Next credit-note number for an entity and the year of the date, e.g. `IDSS-KO-036/26` (S1).
pub fn next_number(tx: &Transaction, entity: &str, issue_date: &str) -> AppResult<String> {
    valid_date(issue_date)?;
    let year: i64 = issue_date[0..4].parse().map_err(|_| AppError::Validation("neispravan datum".into()))?;
    let sequence: i64 = tx.query_row(
        "INSERT INTO credit_note_sequences(entity, year, last_number) VALUES (?1, ?2, 1)
         ON CONFLICT(entity, year) DO UPDATE SET last_number = last_number + 1
         RETURNING last_number",
        params![entity, year],
        |r| r.get(0),
    )?;
    Ok(format!("{entity}-KO-{sequence:03}/{:02}", year % 100))
}

/// Issue a credit note for a whole invoice or part of it (S2). Sets the original to CANCELLED when its
/// net total reaches 0, so the month can be billed again (S6).
pub fn issue_credit_note(tx: &Transaction, draft: &CreditNoteDraft) -> AppResult<IssuedCreditNote> {
    let reason = required_text(&draft.reason, "razlog knjižnog odobrenja")?;
    valid_date(&draft.issue_date)?;
    if draft.lines.is_empty() {
        return Err(AppError::Validation("knjižno odobrenje mora imati barem jednu stavku".into()));
    }
    let inv = original(tx, &draft.invoice_id)?;
    if inv.kind == "CREDIT_NOTE" {
        return Err(AppError::Validation("knjižno odobrenje se ne može stornirati knjižnim odobrenjem".into()));
    }
    if inv.status != "ISSUED" {
        return Err(AppError::Conflict(format!("račun {} je već storniran u cijelosti", inv.number)));
    }
    if draft.issue_date.as_str() < inv.issue_date.as_str() {
        return Err(AppError::Validation("knjižno odobrenje ne može biti prije datuma računa".into()));
    }
    let mut seen = std::collections::HashSet::new();
    let mut rows = Vec::with_capacity(draft.lines.len());
    for line in &draft.lines {
        if line.amount >= 0 {
            return Err(AppError::Validation("iznos knjižnog odobrenja mora biti negativan".into()));
        }
        if !seen.insert(line.position) {
            return Err(AppError::Validation("svaka stavka računa smije se pojaviti samo jednom".into()));
        }
        let source = tx
            .query_row(
                "SELECT item_code, description, child_id, enrolment_id, program, amount FROM invoice_lines
                 WHERE invoice_id = ?1 AND position = ?2",
                params![draft.invoice_id, line.position],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<String>>(4)?,
                        r.get::<_, i64>(5)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| AppError::Validation(format!("račun nema stavku {}", line.position)))?;
        let credited: i64 = tx.query_row(
            "SELECT COALESCE(sum(l.amount), 0) FROM invoice_lines l JOIN invoices cn ON cn.id = l.invoice_id
             WHERE cn.credits_invoice_id = ?1 AND l.credits_position = ?2",
            params![draft.invoice_id, line.position],
            |r| r.get(0),
        )?;
        let remaining = source.5 + credited;
        if -line.amount > remaining {
            return Err(AppError::Validation(format!(
                "stavka {}: može se odobriti najviše {},{:02} KM",
                line.position,
                remaining.max(0) / 100,
                remaining.max(0) % 100
            )));
        }
        rows.push((line, source));
    }
    let total: i64 = draft.lines.iter().map(|l| l.amount).sum();
    let number = next_number(tx, &inv.entity, &draft.issue_date)?;
    tx.execute(
        "INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, buyer_address, issue_date, due_date,
                              period_from, period_to, total_fenings, status, created_at, source, credits_invoice_id, reason)
         VALUES (?1, ?2, ?3, 'CREDIT_NOTE', ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11, 'ISSUED', ?12, 'APP', ?13, ?14)",
        params![
            draft.id, number, inv.entity, inv.family_id, inv.child_id, inv.buyer_name, inv.buyer_address, draft.issue_date,
            inv.period_from, inv.period_to, total, now(), draft.invoice_id, reason
        ],
    )?;
    for (index, (line, (item_code, description, child_id, enrolment_id, program, _))) in rows.iter().enumerate() {
        tx.execute(
            "INSERT INTO invoice_lines(id, invoice_id, position, item_code, description, child_id, enrolment_id, program,
                                       list_amount, amount, credits_position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)",
            params![
                format!("{}-{}", draft.id, index + 1), draft.id, (index + 1) as i64, item_code,
                format!("Storno: {description}"), child_id, enrolment_id, program, line.amount, line.position
            ],
        )?;
    }
    let (net, _) = balance(tx, &draft.invoice_id)?;
    let cancelled = net == 0;
    if cancelled {
        tx.execute("UPDATE invoices SET status = 'CANCELLED' WHERE id = ?1", params![draft.invoice_id])?;
    }
    Ok(IssuedCreditNote { number, cancelled })
}

/// Reverse a wrongly booked payment by a counter-entry (S4). Refused when the money of the payment was
/// already moved away as credit (the invoice would end with negative effective payments).
pub fn reverse_payment(tx: &Transaction, payment_id: &str, reversed_on: &str, reason: &str) -> AppResult<String> {
    let reason = required_text(reason, "razlog storna uplate")?;
    valid_date(reversed_on)?;
    let (invoice_id, amount): (String, i64) = tx
        .query_row("SELECT invoice_id, amount FROM payments WHERE id = ?1", params![payment_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| AppError::NotFound("uplata ne postoji".into()))?;
    let reversed: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM payment_reversals WHERE payment_id = ?1)", params![payment_id], |r| {
        r.get(0)
    })?;
    if reversed {
        return Err(AppError::Conflict("uplata je već stornirana".into()));
    }
    let (_, paid) = balance(tx, &invoice_id)?;
    if paid - amount < 0 {
        return Err(AppError::Conflict(
            "novac ove uplate je već primijenjen kao pretplata na drugi račun ili vraćen — prvo stornirajte tu primjenu".into(),
        ));
    }
    tx.execute(
        "INSERT INTO payment_reversals(id, payment_id, reversed_on, reason, created_at) VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4)",
        params![payment_id, reversed_on, reason, now()],
    )?;
    Ok(invoice_id)
}

/// Move a family's credit from one invoice to an open invoice of the same family and institution, or
/// record a refund to the parent when `to_invoice_id` is None (S3; entities are never mixed).
pub fn move_credit(
    tx: &Transaction,
    from_invoice_id: &str,
    to_invoice_id: Option<&str>,
    amount: i64,
    moved_on: &str,
    note: &str,
) -> AppResult<()> {
    let note = required_text(note, "napomenu")?;
    valid_date(moved_on)?;
    if amount <= 0 {
        return Err(AppError::Validation("iznos mora biti veći od nule".into()));
    }
    let from = original(tx, from_invoice_id)?;
    if from.kind == "CREDIT_NOTE" {
        return Err(AppError::Validation("kredit se prebacuje s računa, ne s knjižnog odobrenja".into()));
    }
    let (net, paid) = balance(tx, from_invoice_id)?;
    if paid - net < amount {
        return Err(AppError::Validation(format!(
            "na računu {} je raspoloživo najviše {},{:02} KM kredita",
            from.number,
            (paid - net).max(0) / 100,
            (paid - net).max(0) % 100
        )));
    }
    if let Some(to_id) = to_invoice_id {
        if to_id == from_invoice_id {
            return Err(AppError::Validation("kredit se ne prebacuje na isti račun".into()));
        }
        let to = original(tx, to_id)?;
        if to.family_id != from.family_id {
            return Err(AppError::Validation("kredit se prebacuje samo na račun iste porodice".into()));
        }
        if to.entity != from.entity {
            return Err(AppError::Validation("kredit jedne ustanove ne može platiti račun druge ustanove".into()));
        }
        if to.kind == "CREDIT_NOTE" || to.status != "ISSUED" {
            return Err(AppError::Validation("kredit se prebacuje samo na izdat, nestorniran račun".into()));
        }
        let (to_net, to_paid) = balance(tx, to_id)?;
        if to_net - to_paid < amount {
            return Err(AppError::Validation(format!("na računu {} je otvoreno manje od tog iznosa", to.number)));
        }
    }
    tx.execute(
        "INSERT INTO credit_movements(id, from_invoice_id, to_invoice_id, amount, moved_on, note, created_at)
         VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?6)",
        params![from_invoice_id, to_invoice_id, amount, moved_on, note, now()],
    )?;
    Ok(())
}

/// Link a credit note imported from the old workbook to the invoice it cancels (S5) and resolve its
/// „Knjižno odobrenje bez veze“ finding in the same transaction.
pub fn link_legacy_credit_note(tx: &Transaction, credit_note_id: &str, invoice_id: &str) -> AppResult<()> {
    let cn = original(tx, credit_note_id)?;
    let (source, linked): (String, Option<String>) = tx.query_row(
        "SELECT source, credits_invoice_id FROM invoices WHERE id = ?1",
        params![credit_note_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if cn.kind != "CREDIT_NOTE" || source != "LEGACY" {
        return Err(AppError::Validation("povezuje se samo knjižno odobrenje uvezeno iz starog rješenja".into()));
    }
    if linked.is_some() {
        return Err(AppError::Conflict("knjižno odobrenje je već povezano".into()));
    }
    let target = original(tx, invoice_id)?;
    if target.kind == "CREDIT_NOTE" {
        return Err(AppError::Validation("knjižno odobrenje se povezuje s računom, ne s drugim knjižnim odobrenjem".into()));
    }
    if target.entity != cn.entity || target.family_id != cn.family_id {
        return Err(AppError::Validation("račun mora biti iste ustanove i iste porodice".into()));
    }
    if target.status != "ISSUED" {
        return Err(AppError::Conflict(format!("račun {} je već storniran u cijelosti", target.number)));
    }
    let (net, _) = balance(tx, invoice_id)?;
    let cn_total: i64 = tx.query_row("SELECT total_fenings FROM invoices WHERE id = ?1", params![credit_note_id], |r| r.get(0))?;
    if net + cn_total < 0 {
        return Err(AppError::Validation(format!("knjižno odobrenje je veće od preostalog iznosa računa {}", target.number)));
    }
    tx.execute("UPDATE invoices SET credits_invoice_id = ?1 WHERE id = ?2", params![invoice_id, credit_note_id])?;
    if net + cn_total == 0 {
        tx.execute("UPDATE invoices SET status = 'CANCELLED' WHERE id = ?1", params![invoice_id])?;
    }
    tx.execute(
        "UPDATE legacy_import_findings SET resolved_at = ?1, resolution_note = ?2
         WHERE category = 'CREDIT_NOTE_UNLINKED' AND invoice_id = ?3 AND resolved_at IS NULL",
        params![now(), format!("Povezano s računom {}", target.number), credit_note_id],
    )?;
    Ok(())
}

/// Invoices of a family that carry credit (effective paid above the net total), per institution.
pub fn family_credit(conn: &Connection, family_id: &str) -> AppResult<Vec<FamilyCredit>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT i.id, i.number, i.entity, {PAID_SQL} - {NET_SQL} AS credit FROM invoices i
         WHERE i.family_id = ?1 AND i.kind <> 'CREDIT_NOTE' AND {PAID_SQL} - {NET_SQL} > 0
         ORDER BY i.entity, i.issue_date, i.number"
    ))?;
    let rows = stmt.query_map(params![family_id], |r| {
        Ok(FamilyCredit { invoice_id: r.get(0)?, number: r.get(1)?, entity: r.get(2)?, credit: r.get(3)? })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    /// Family f with child c (IDSS), two invoices of 700,00 KM (two lines 500 + 200) and one IMH invoice.
    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO families(id, display_name, created_at) VALUES ('f', 'T', 'x'), ('g', 'U', 'x');
             INSERT INTO children(id, family_id, first_name, last_name, date_of_birth, residency, created_at)
               VALUES ('c', 'f', 'A', 'T', '2016-01-01', 'DOMESTIC', 'x');
             INSERT INTO enrolments(id, child_id, program, school_year, starts_on, status, created_at)
               VALUES ('e', 'c', 'PRIMARY_1_4', '2026/2027', '2026-09-01', 'ACTIVE', 'x');
             INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, issue_date, due_date, period_from, period_to,
                                  total_fenings, status, created_at)
               VALUES ('a', 'IDSS-001/26', 'IDSS', 'MONTHLY', 'f', 'c', 'B', '2026-10-01', '2026-10-05', '2026-10-01', '2026-10-31', 70000, 'ISSUED', 'x'),
                      ('b', 'IDSS-002/26', 'IDSS', 'MONTHLY', 'f', 'c', 'B', '2026-11-01', '2026-11-05', '2026-11-01', '2026-11-30', 70000, 'ISSUED', 'x'),
                      ('h', 'IMH-001/26', 'IMH', 'OTHER', 'f', NULL, 'B', '2026-11-01', '2026-11-05', '2026-11-01', '2026-11-30', 10000, 'ISSUED', 'x'),
                      ('o', 'IDSS-003/26', 'IDSS', 'OTHER', 'g', NULL, 'B', '2026-11-01', '2026-11-05', '2026-11-01', '2026-11-30', 10000, 'ISSUED', 'x');
             INSERT INTO invoice_lines(id, invoice_id, position, item_code, description, child_id, enrolment_id, program, list_amount, amount)
               VALUES ('a-1', 'a', 1, 'TUITION', 'Školarina', 'c', 'e', 'PRIMARY_1_4', 50000, 50000),
                      ('a-2', 'a', 2, 'BREAKFAST', 'Doručak', 'c', 'e', 'PRIMARY_1_4', 20000, 20000),
                      ('b-1', 'b', 1, 'TUITION', 'Školarina', 'c', 'e', 'PRIMARY_1_4', 70000, 70000);",
        )
        .unwrap();
        conn
    }

    fn draft(id: &str, invoice: &str, lines: &[(i64, i64)]) -> CreditNoteDraft {
        CreditNoteDraft {
            id: id.into(),
            invoice_id: invoice.into(),
            issue_date: "2026-11-10".into(),
            reason: "pogrešan iznos".into(),
            lines: lines.iter().map(|(position, amount)| CreditNoteLine { position: *position, amount: *amount }).collect(),
        }
    }

    fn pay(tx: &Transaction, id: &str, invoice: &str, amount: i64) {
        tx.execute(
            "INSERT INTO payments(id, invoice_id, paid_on, amount, payer_name, created_at) VALUES (?1, ?2, '2026-10-03', ?3, 'B', 'x')",
            params![id, invoice, amount],
        )
        .unwrap();
    }

    #[test]
    fn partial_then_full_credit_note_numbers_and_cancels() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        let first = issue_credit_note(&tx, &draft("k1", "a", &[(2, -5000)])).unwrap();
        assert_eq!(first, IssuedCreditNote { number: "IDSS-KO-001/26".into(), cancelled: false });
        assert_eq!(balance(&tx, "a").unwrap(), (65000, 0));
        // line 2 has 150,00 left; 160,00 is refused
        assert!(matches!(issue_credit_note(&tx, &draft("k2", "a", &[(2, -16000)])), Err(AppError::Validation(_))));
        let second = issue_credit_note(&tx, &draft("k3", "a", &[(1, -50000), (2, -15000)])).unwrap();
        assert_eq!(second, IssuedCreditNote { number: "IDSS-KO-002/26".into(), cancelled: true });
        assert_eq!(balance(&tx, "a").unwrap().0, 0);
        assert!(matches!(issue_credit_note(&tx, &draft("k4", "a", &[(1, -1)])), Err(AppError::Conflict(_))), "already fully cancelled");
        let status: String = tx.query_row("SELECT status FROM invoices WHERE id = 'a'", [], |r| r.get(0)).unwrap();
        assert_eq!(status, "CANCELLED");
        tx.commit().unwrap();
    }

    #[test]
    fn a_fully_cancelled_monthly_invoice_can_be_billed_again_s6() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        issue_credit_note(&tx, &draft("k1", "a", &[(1, -50000), (2, -20000)])).unwrap();
        tx.execute(
            "INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, issue_date, due_date, period_from, period_to,
                                  total_fenings, status, created_at)
             VALUES ('a2', 'IDSS-004/26', 'IDSS', 'MONTHLY', 'f', 'c', 'B', '2026-11-10', '2026-11-15', '2026-10-01', '2026-10-31', 65000, 'ISSUED', 'x')",
            [],
        )
        .expect("the per-child monthly guard counts only ISSUED invoices");
    }

    #[test]
    fn validation_of_drafts() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        let mut no_reason = draft("k", "a", &[(1, -100)]);
        no_reason.reason = "  ".into();
        assert!(issue_credit_note(&tx, &no_reason).is_err());
        assert!(issue_credit_note(&tx, &draft("k", "a", &[(1, 100)])).is_err(), "positive");
        assert!(issue_credit_note(&tx, &draft("k", "a", &[(9, -100)])).is_err(), "no such line");
        assert!(issue_credit_note(&tx, &draft("k", "a", &[(1, -100), (1, -100)])).is_err(), "line twice");
        let mut early = draft("k", "a", &[(1, -100)]);
        early.issue_date = "2026-09-30".into();
        assert!(issue_credit_note(&tx, &early).is_err(), "before the invoice date");
        assert!(issue_credit_note(&tx, &draft("k", "zz", &[(1, -100)])).is_err(), "unknown invoice");
    }

    #[test]
    fn numbering_continues_after_imported_legacy_credit_notes_s1() {
        let mut conn = db();
        conn.execute("INSERT INTO credit_note_sequences(entity, year, last_number) VALUES ('IDSS', 2026, 35)", []).unwrap();
        let tx = conn.transaction().unwrap();
        assert_eq!(issue_credit_note(&tx, &draft("k1", "a", &[(1, -100)])).unwrap().number, "IDSS-KO-036/26");
        assert_eq!(next_number(&tx, "IMH", "2026-11-10").unwrap(), "IMH-KO-001/26");
        assert_eq!(next_number(&tx, "IDSS", "2027-01-02").unwrap(), "IDSS-KO-001/27");
    }

    #[test]
    fn paid_money_on_a_cancelled_invoice_becomes_credit_and_moves_only_within_the_entity_s3() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        pay(&tx, "p1", "a", 70000);
        issue_credit_note(&tx, &draft("k1", "a", &[(1, -50000), (2, -20000)])).unwrap();
        assert_eq!(family_credit(&tx, "f").unwrap(), vec![FamilyCredit { invoice_id: "a".into(), number: "IDSS-001/26".into(), entity: "IDSS".into(), credit: 70000 }]);
        assert!(move_credit(&tx, "a", Some("h"), 10000, "2026-11-11", "prebačeno").is_err(), "IDSS credit never pays IMH");
        assert!(move_credit(&tx, "a", Some("o"), 10000, "2026-11-11", "prebačeno").is_err(), "other family");
        assert!(move_credit(&tx, "a", Some("b"), 80000, "2026-11-11", "prebačeno").is_err(), "more than the credit");
        move_credit(&tx, "a", Some("b"), 60000, "2026-11-11", "prebačeno na novembar").unwrap();
        move_credit(&tx, "a", None, 10000, "2026-11-12", "povrat na račun roditelja").unwrap();
        assert!(move_credit(&tx, "a", None, 1, "2026-11-12", "opet").is_err(), "no credit left");
        assert_eq!(balance(&tx, "b").unwrap(), (70000, 60000));
        assert!(family_credit(&tx, "f").unwrap().is_empty());
        // money is conserved: paid = applied + refunded + remaining credit
        let (paid, moved_in, refunded): (i64, i64, i64) = tx
            .query_row(
                "SELECT (SELECT sum(amount) FROM payments), (SELECT sum(amount) FROM credit_movements WHERE to_invoice_id IS NOT NULL),
                        (SELECT sum(amount) FROM credit_movements WHERE to_invoice_id IS NULL)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(paid, moved_in + refunded);
    }

    #[test]
    fn payment_reversal_is_a_counter_entry_s4() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        pay(&tx, "p1", "a", 70000);
        assert!(reverse_payment(&tx, "p1", "2026-11-11", " ").is_err(), "reason required");
        assert_eq!(reverse_payment(&tx, "p1", "2026-11-11", "uplata je za drugo dijete").unwrap(), "a");
        assert_eq!(balance(&tx, "a").unwrap(), (70000, 0));
        assert!(matches!(reverse_payment(&tx, "p1", "2026-11-11", "opet"), Err(AppError::Conflict(_))));
        let kept: i64 = tx.query_row("SELECT count(*) FROM payments", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 1, "the payment itself is never deleted");
        // money already moved away cannot be reversed
        pay(&tx, "p2", "b", 70000);
        issue_credit_note(&tx, &draft("k1", "b", &[(1, -70000)])).unwrap();
        move_credit(&tx, "b", None, 70000, "2026-11-12", "povrat").unwrap();
        assert!(matches!(reverse_payment(&tx, "p2", "2026-11-13", "greška"), Err(AppError::Conflict(_))));
    }

    #[test]
    fn legacy_credit_note_is_linked_by_hand_s5() {
        let mut conn = db();
        conn.execute_batch(
            "INSERT INTO invoices(id, number, entity, kind, family_id, buyer_name, issue_date, due_date, period_from, period_to,
                                  total_fenings, status, created_at, source)
               VALUES ('lo', 'IDSS 363/26', 'IDSS', 'OTHER', 'f', 'B', '2026-07-01', '2026-07-01', '2026-07-01', '2026-07-31', 91916, 'ISSUED', 'x', 'LEGACY'),
                      ('lk', 'IDSS KO-35/26', 'IDSS', 'CREDIT_NOTE', 'f', 'B', '2026-08-01', '2026-08-01', '2026-08-01', '2026-08-31', -91916, 'ISSUED', 'x', 'LEGACY');
             INSERT INTO legacy_import_findings(id, finding_key, category, severity, entity, number, invoice_id, excel_rows, reason,
                                                first_seen_at, last_seen_at, last_seen_file)
               VALUES ('g', 'CREDIT_NOTE_UNLINKED|IDSS|KO-35/26', 'CREDIT_NOTE_UNLINKED', 'REVIEW', 'IDSS', 'KO-35/26', 'lk', 'DB 9', 'r', 'x', 'x', 'f');",
        )
        .unwrap();
        let tx = conn.transaction().unwrap();
        assert!(link_legacy_credit_note(&tx, "lk", "h").is_err(), "other institution");
        assert!(link_legacy_credit_note(&tx, "a", "lo").is_err(), "not a legacy credit note");
        link_legacy_credit_note(&tx, "lk", "lo").unwrap();
        assert_eq!(balance(&tx, "lo").unwrap().0, 0);
        let (status, resolved): (String, Option<String>) = tx
            .query_row(
                "SELECT (SELECT status FROM invoices WHERE id = 'lo'), (SELECT resolution_note FROM legacy_import_findings WHERE id = 'g' AND resolved_at IS NOT NULL)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "CANCELLED");
        assert_eq!(resolved.as_deref(), Some("Povezano s računom IDSS 363/26"));
        assert!(matches!(link_legacy_credit_note(&tx, "lk", "lo"), Err(AppError::Conflict(_))), "only once");
    }
}
