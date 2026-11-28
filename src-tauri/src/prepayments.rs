//! Child prepayment (specs/family-advance, Director 2026-11-28: Q1–Q6, BR-24 amended; migration 016).
//!
//! A child has one ledger card per institution: saldo = charged − paid + refunded, negative = u pretplati.
//! Prepaid money has two sources, spent oldest first:
//! - a payment without an invoice (`prepayments`);
//! - the excess on an invoice of the child (effective paid above its net, Q4) — never copied, always computed.
//!
//! It is used on an invoice of the same child (or, with a note, of a brother or sister — same family, same
//! institution), or refunded. Everything is append-only; corrections are reversals with a reason.

use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::credit_notes::{balance, required_text, valid_date, NET_SQL, PAID_SQL};
use crate::error::{AppError, AppResult};
use crate::formats::check_name;
use crate::invoices::MAX_AMOUNT;
use crate::repository::now;

const ENTITIES: [&str; 2] = ["IMH", "IDSS"];
const LIVE_USE: &str = "NOT EXISTS (SELECT 1 FROM prepayment_use_reversals ur WHERE ur.use_id = u.id)";

fn km(fenings: i64) -> String {
    let sign = if fenings < 0 { "-" } else { "" };
    let a = fenings.abs();
    let whole = (a / 100).to_string();
    let mut grouped = String::new();
    for (i, ch) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    format!("{sign}{grouped},{:02} KM", a % 100)
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrepaymentInput {
    pub id: String,
    pub family_id: String,
    pub entity: String,
    pub child_id: String,
    pub paid_on: String,
    pub amount: i64,
    pub payer_name: String,
    pub payer_relation: String,
    #[serde(default)]
    pub reference: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrepaymentUse {
    pub id: String,
    /// None = refund.
    pub invoice_id: Option<String>,
    pub invoice_number: Option<String>,
    pub amount: i64,
    pub used_on: String,
    pub note: String,
    pub reversed_on: Option<String>,
    pub reversal_reason: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prepayment {
    pub id: String,
    pub entity: String,
    pub child_id: String,
    pub paid_on: String,
    pub amount: i64,
    pub payer_name: String,
    pub payer_relation: String,
    pub reference: String,
    pub note: String,
    pub reversed_on: Option<String>,
    pub reversal_reason: Option<String>,
    /// Not yet used or refunded (0 when reversed).
    pub remaining: i64,
    pub uses: Vec<PrepaymentUse>,
}

/// One child's ledger card in one institution. `child_id` None = invoices without a child (manual / legacy).
/// Identity (tested): saldo = charged − received − transferred_in + transferred_out + refunded.
#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChildBalance {
    pub entity: String,
    pub child_id: Option<String>,
    /// Invoices net of credit notes.
    pub charged: i64,
    /// Money received for this child: payments on its invoices and payments without an invoice (not reversed).
    pub received: i64,
    /// Money of a brother or sister used on this child's invoices, and the reverse.
    pub transferred_in: i64,
    pub transferred_out: i64,
    pub refunded: i64,
    /// Prepaid money available: unused payments without an invoice + excess on the child's invoices.
    pub prepaid: i64,
    /// charged − paid + refunded; negative = u pretplati.
    pub saldo: i64,
}

/// A source of prepaid money, oldest first.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrepaidSource {
    /// PREPAYMENT (payment without an invoice) or EXCESS (excess on an invoice).
    pub kind: String,
    pub id: String,
    pub date: String,
    /// The invoice number for EXCESS.
    pub label: String,
    pub remaining: i64,
}

/// Record a payment without an invoice for one child in one institution (Q1, BR-24).
pub fn record_prepayment(tx: &Transaction, p: &PrepaymentInput) -> AppResult<()> {
    if !ENTITIES.contains(&p.entity.as_str()) {
        return Err(AppError::Validation("izaberite ustanovu (IMH ili IDSS)".into()));
    }
    if p.amount <= 0 {
        return Err(AppError::Validation("iznos uplate mora biti veći od nule".into()));
    }
    if p.amount > MAX_AMOUNT {
        return Err(AppError::Validation("iznos uplate je veći od 100.000,00 KM — provjerite iznos".into()));
    }
    valid_date(&p.paid_on)?;
    if p.paid_on.as_str() > &now()[0..10] {
        return Err(AppError::Validation("datum uplate ne može biti u budućnosti".into()));
    }
    check_name(&p.payer_name, "ime uplatioca")?;
    let relation = required_text(&p.payer_relation, "odnos uplatioca prema djetetu")?;
    let in_family: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM children WHERE id = ?1 AND family_id = ?2)",
        params![p.child_id, p.family_id],
        |r| r.get(0),
    )?;
    if !in_family {
        return Err(AppError::Validation("izaberite dijete iz ove porodice".into()));
    }
    tx.execute(
        "INSERT INTO prepayments(id, family_id, entity, child_id, paid_on, amount, payer_name, payer_relation, reference, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            p.id, p.family_id, p.entity, p.child_id, p.paid_on, p.amount, p.payer_name.trim(), relation,
            p.reference.trim(), p.note.trim(), now()
        ],
    )?;
    Ok(())
}

/// Unused money of a payment without an invoice (0 when reversed).
fn prepayment_remaining(conn: &Connection, prepayment_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        &format!(
            "SELECT CASE WHEN EXISTS (SELECT 1 FROM prepayment_reversals r WHERE r.prepayment_id = p.id) THEN 0
                    ELSE p.amount - COALESCE((SELECT sum(u.amount) FROM prepayment_uses u WHERE u.prepayment_id = p.id AND {LIVE_USE}), 0) END
             FROM prepayments p WHERE p.id = ?1"
        ),
        params![prepayment_id],
        |r| r.get(0),
    )?)
}

/// Prepaid money of a child (or of the invoices without a child) in one institution, oldest first.
pub fn sources(conn: &Connection, family_id: &str, entity: &str, child_id: Option<&str>) -> AppResult<Vec<PrepaidSource>> {
    let mut out = Vec::new();
    if let Some(child) = child_id {
        let mut stmt = conn.prepare(
            "SELECT id, paid_on FROM prepayments WHERE family_id = ?1 AND entity = ?2 AND child_id = ?3 ORDER BY paid_on, created_at, id",
        )?;
        let rows = stmt
            .query_map(params![family_id, entity, child], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for (id, date) in rows {
            let remaining = prepayment_remaining(conn, &id)?;
            if remaining > 0 {
                out.push(PrepaidSource { kind: "PREPAYMENT".into(), id, date, label: String::new(), remaining });
            }
        }
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT i.id, i.issue_date, i.number, {PAID_SQL} - {NET_SQL} FROM invoices i
         WHERE i.family_id = ?1 AND i.entity = ?2 AND i.child_id IS ?3 AND i.kind <> 'CREDIT_NOTE' AND {PAID_SQL} - {NET_SQL} > 0
         ORDER BY i.issue_date, i.number"
    ))?;
    let excess = stmt
        .query_map(params![family_id, entity, child_id], |r| {
            Ok(PrepaidSource { kind: "EXCESS".into(), id: r.get(0)?, date: r.get(1)?, label: r.get(2)?, remaining: r.get(3)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    out.extend(excess);
    out.sort_by(|a, b| a.date.cmp(&b.date).then(a.id.cmp(&b.id)));
    Ok(out)
}

struct Target {
    number: String,
    family_id: String,
    entity: String,
    kind: String,
    status: String,
    child_id: Option<String>,
}

fn target(tx: &Transaction, invoice_id: &str) -> AppResult<Target> {
    tx.query_row(
        "SELECT number, family_id, entity, kind, status, child_id FROM invoices WHERE id = ?1",
        params![invoice_id],
        |r| Ok(Target { number: r.get(0)?, family_id: r.get(1)?, entity: r.get(2)?, kind: r.get(3)?, status: r.get(4)?, child_id: r.get(5)? }),
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound("račun ne postoji".into()))
}

/// Use a child's prepaid money on an invoice (`invoice_id` Some) or refund it (None). Sources are spent oldest
/// first. An invoice of another child of the family needs `sibling` and a note (Q1). Returns the new use ids.
#[allow(clippy::too_many_arguments)]
pub fn use_prepaid(
    tx: &Transaction,
    family_id: &str,
    entity: &str,
    child_id: Option<&str>,
    invoice_id: Option<&str>,
    amount: i64,
    used_on: &str,
    note: &str,
    sibling: bool,
) -> AppResult<Vec<String>> {
    let note = required_text(note, "napomenu")?;
    valid_date(used_on)?;
    if amount <= 0 {
        return Err(AppError::Validation("iznos mora biti veći od nule".into()));
    }
    if let Some(to_id) = invoice_id {
        let to = target(tx, to_id)?;
        if to.family_id != family_id {
            return Err(AppError::Validation("pretplata se primjenjuje samo na račun iste porodice".into()));
        }
        if to.entity != entity {
            return Err(AppError::Validation("pretplata jedne ustanove ne može platiti račun druge ustanove".into()));
        }
        if to.kind == "CREDIT_NOTE" || to.status != "ISSUED" {
            return Err(AppError::Validation("pretplata se primjenjuje samo na izdat, nestorniran račun".into()));
        }
        if child_id.is_some() && to.child_id.as_deref() != child_id && !sibling {
            return Err(AppError::Validation(format!(
                "račun {} je za drugo dijete — za prenos na brata ili sestru potvrdite prenos i upišite napomenu",
                to.number
            )));
        }
        let (net, paid) = balance(tx, to_id)?;
        if net - paid < amount {
            return Err(AppError::Validation(format!("na računu {} je otvoreno {} — manje od tog iznosa", to.number, km((net - paid).max(0)))));
        }
    }
    let available: Vec<PrepaidSource> =
        sources(tx, family_id, entity, child_id)?.into_iter().filter(|s| Some(s.id.as_str()) != invoice_id).collect();
    let total: i64 = available.iter().map(|s| s.remaining).sum();
    if total < amount {
        return Err(AppError::Validation(format!("pretplata je {} — ne može se primijeniti ni vratiti više", km(total))));
    }
    let mut left = amount;
    let mut ids = Vec::new();
    for source in available {
        if left == 0 {
            break;
        }
        let part = left.min(source.remaining);
        let id: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
        let (prepayment, source_invoice) =
            if source.kind == "PREPAYMENT" { (Some(source.id.as_str()), None) } else { (None, Some(source.id.as_str())) };
        tx.execute(
            "INSERT INTO prepayment_uses(id, prepayment_id, source_invoice_id, invoice_id, amount, used_on, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, prepayment, source_invoice, invoice_id, part, used_on, note, now()],
        )?;
        ids.push(id);
        left -= part;
    }
    Ok(ids)
}

/// Reverse a payment without an invoice (S4). Refused while any of its money is used or refunded.
pub fn reverse_prepayment(tx: &Transaction, prepayment_id: &str, reversed_on: &str, reason: &str) -> AppResult<()> {
    let reason = required_text(reason, "razlog storna uplate")?;
    valid_date(reversed_on)?;
    let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM prepayments WHERE id = ?1)", params![prepayment_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::NotFound("uplata ne postoji".into()));
    }
    let reversed: bool =
        tx.query_row("SELECT EXISTS(SELECT 1 FROM prepayment_reversals WHERE prepayment_id = ?1)", params![prepayment_id], |r| r.get(0))?;
    if reversed {
        return Err(AppError::Conflict("uplata je već stornirana".into()));
    }
    let used: i64 = tx.query_row(
        &format!("SELECT count(*) FROM prepayment_uses u WHERE u.prepayment_id = ?1 AND {LIVE_USE}"),
        params![prepayment_id],
        |r| r.get(0),
    )?;
    if used > 0 {
        return Err(AppError::Conflict(
            "novac ove uplate je već primijenjen na račun ili vraćen — prvo stornirajte tu primjenu, pa uplatu".into(),
        ));
    }
    tx.execute(
        "INSERT INTO prepayment_reversals(id, prepayment_id, reversed_on, reason, created_at) VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4)",
        params![prepayment_id, reversed_on, reason, now()],
    )?;
    Ok(())
}

/// Reverse one use of prepaid money (an application or a refund). Refused when the invoice it paid has already
/// passed that money on (its effective paid would turn negative).
pub fn reverse_use(tx: &Transaction, use_id: &str, reversed_on: &str, reason: &str) -> AppResult<()> {
    let reason = required_text(reason, "razlog storna")?;
    valid_date(reversed_on)?;
    let (invoice_id, amount): (Option<String>, i64) = tx
        .query_row("SELECT invoice_id, amount FROM prepayment_uses WHERE id = ?1", params![use_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| AppError::NotFound("primjena pretplate ne postoji".into()))?;
    let reversed: bool =
        tx.query_row("SELECT EXISTS(SELECT 1 FROM prepayment_use_reversals WHERE use_id = ?1)", params![use_id], |r| r.get(0))?;
    if reversed {
        return Err(AppError::Conflict("već je stornirano".into()));
    }
    if let Some(to) = invoice_id.as_deref() {
        let (_, paid) = balance(tx, to)?;
        if paid - amount < 0 {
            return Err(AppError::Conflict("novac je s tog računa već primijenjen dalje ili vraćen — prvo stornirajte to".into()));
        }
    }
    tx.execute(
        "INSERT INTO prepayment_use_reversals(id, use_id, reversed_on, reason, created_at) VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4)",
        params![use_id, reversed_on, reason, now()],
    )?;
    Ok(())
}

/// Payments without an invoice of a family, with their uses, oldest first.
pub fn list_prepayments(conn: &Connection, family_id: &str) -> AppResult<Vec<Prepayment>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.entity, p.child_id, p.paid_on, p.amount, p.payer_name, p.payer_relation, p.reference, p.note, r.reversed_on, r.reason
         FROM prepayments p LEFT JOIN prepayment_reversals r ON r.prepayment_id = p.id
         WHERE p.family_id = ?1 ORDER BY p.entity, p.paid_on, p.created_at",
    )?;
    let rows = stmt
        .query_map(params![family_id], |r| {
            Ok(Prepayment {
                id: r.get(0)?,
                entity: r.get(1)?,
                child_id: r.get(2)?,
                paid_on: r.get(3)?,
                amount: r.get(4)?,
                payer_name: r.get(5)?,
                payer_relation: r.get(6)?,
                reference: r.get(7)?,
                note: r.get(8)?,
                reversed_on: r.get(9)?,
                reversal_reason: r.get(10)?,
                remaining: 0,
                uses: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut uses = conn.prepare(
        "SELECT u.id, u.invoice_id, i.number, u.amount, u.used_on, u.note, ur.reversed_on, ur.reason
         FROM prepayment_uses u LEFT JOIN invoices i ON i.id = u.invoice_id LEFT JOIN prepayment_use_reversals ur ON ur.use_id = u.id
         WHERE u.prepayment_id = ?1 ORDER BY u.used_on, u.created_at",
    )?;
    rows.into_iter()
        .map(|mut p| {
            p.remaining = prepayment_remaining(conn, &p.id)?;
            p.uses = uses
                .query_map(params![p.id], |r| {
                    Ok(PrepaymentUse {
                        id: r.get(0)?,
                        invoice_id: r.get(1)?,
                        invoice_number: r.get(2)?,
                        amount: r.get(3)?,
                        used_on: r.get(4)?,
                        note: r.get(5)?,
                        reversed_on: r.get(6)?,
                        reversal_reason: r.get(7)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(p)
        })
        .collect()
}

/// Uses of prepaid money whose source is the excess on an invoice, or that paid an invoice (for its detail).
pub fn invoice_uses(conn: &Connection, invoice_id: &str) -> AppResult<Vec<PrepaymentUse>> {
    let mut stmt = conn.prepare(
        "SELECT u.id, u.invoice_id, i.number, CASE WHEN u.invoice_id = ?1 THEN u.amount ELSE -u.amount END, u.used_on, u.note, ur.reversed_on, ur.reason
         FROM prepayment_uses u LEFT JOIN invoices i ON i.id = u.invoice_id LEFT JOIN prepayment_use_reversals ur ON ur.use_id = u.id
         WHERE u.invoice_id = ?1 OR u.source_invoice_id = ?1 ORDER BY u.used_on, u.created_at",
    )?;
    let rows = stmt
        .query_map(params![invoice_id], |r| {
            Ok(PrepaymentUse {
                id: r.get(0)?,
                invoice_id: r.get(1)?,
                invoice_number: r.get(2)?,
                amount: r.get(3)?,
                used_on: r.get(4)?,
                note: r.get(5)?,
                reversed_on: r.get(6)?,
                reversal_reason: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

type Key = (String, Option<String>);

/// The ledger card of every child of a family, per institution (Q1). One definition of paid (PAID_SQL, M-7).
pub fn child_balances(conn: &Connection, family_id: &str) -> AppResult<Vec<ChildBalance>> {
    let mut cards: BTreeMap<Key, ChildBalance> = BTreeMap::new();
    let card = |key: &Key| -> ChildBalance {
        ChildBalance { entity: key.0.clone(), child_id: key.1.clone(), ..Default::default() }
    };
    // invoices: charged, effective paid, received payments, excess
    let mut invoice_key: BTreeMap<String, Key> = BTreeMap::new();
    let mut stmt = conn.prepare(&format!(
        "SELECT i.id, i.entity, i.child_id, {NET_SQL}, {PAID_SQL},
                COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id
                          AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)), 0)
         FROM invoices i WHERE i.family_id = ?1 AND i.kind <> 'CREDIT_NOTE'"
    ))?;
    let invoices = stmt
        .query_map(params![family_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, entity, child, net, paid, received) in invoices {
        let key = (entity, child);
        let c = cards.entry(key.clone()).or_insert_with(|| card(&key));
        c.charged += net;
        c.saldo += net - paid;
        c.received += received;
        c.prepaid += (paid - net).max(0);
        invoice_key.insert(id, key);
    }
    // payments without an invoice
    let mut prepayment_key: BTreeMap<String, Key> = BTreeMap::new();
    let mut stmt = conn.prepare(
        "SELECT p.id, p.entity, p.child_id, p.amount, EXISTS (SELECT 1 FROM prepayment_reversals r WHERE r.prepayment_id = p.id)
         FROM prepayments p WHERE p.family_id = ?1",
    )?;
    let prepayments = stmt
        .query_map(params![family_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, bool>(4)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, entity, child, amount, reversed) in prepayments {
        let key = (entity, Some(child));
        let remaining = prepayment_remaining(conn, &id)?;
        let c = cards.entry(key.clone()).or_insert_with(|| card(&key));
        if !reversed {
            c.received += amount;
        }
        c.prepaid += remaining;
        c.saldo -= remaining;
        prepayment_key.insert(id, key);
    }
    // movements of money between cards: uses (not reversed) and the older credit movements (S3)
    let mut moves: Vec<(Option<Key>, Option<Key>, i64)> = Vec::new();
    let mut stmt = conn.prepare(&format!(
        "SELECT u.prepayment_id, u.source_invoice_id, u.invoice_id, u.amount FROM prepayment_uses u
         WHERE {LIVE_USE} AND (u.prepayment_id IN (SELECT id FROM prepayments WHERE family_id = ?1)
                OR u.source_invoice_id IN (SELECT id FROM invoices WHERE family_id = ?1))"
    ))?;
    let uses = stmt
        .query_map(params![family_id], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, i64>(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (prepayment, source_invoice, to, amount) in uses {
        let from = match (prepayment, source_invoice) {
            (Some(p), _) => prepayment_key.get(&p).cloned(),
            (None, Some(i)) => invoice_key.get(&i).cloned(),
            _ => None,
        };
        moves.push((from, to.and_then(|t| invoice_key.get(&t).cloned()), amount));
    }
    let mut stmt = conn.prepare(
        "SELECT m.from_invoice_id, m.to_invoice_id, m.amount FROM credit_movements m
         WHERE m.from_invoice_id IN (SELECT id FROM invoices WHERE family_id = ?1)",
    )?;
    let credit = stmt
        .query_map(params![family_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, i64>(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    for (from, to, amount) in credit {
        moves.push((invoice_key.get(&from).cloned(), to.and_then(|t| invoice_key.get(&t).cloned()), amount));
    }
    for (from, to, amount) in moves {
        let Some(from) = from else { continue };
        match to {
            None => cards.entry(from.clone()).or_insert_with(|| card(&from)).refunded += amount,
            Some(to) if to != from => {
                cards.entry(from.clone()).or_insert_with(|| card(&from)).transferred_out += amount;
                cards.entry(to.clone()).or_insert_with(|| card(&to)).transferred_in += amount;
            }
            Some(_) => {}
        }
    }
    Ok(cards.into_values().collect())
}

/// A child's card with the names, for reports (the XLSX list „Pretplate“, step E).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NamedBalance {
    pub family_id: String,
    pub family_name: String,
    pub child_name: String,
    #[serde(flatten)]
    pub balance: ChildBalance,
}

/// Every child's card of every family, optionally of one institution (BR-1: never mixed in one row).
pub fn all_child_balances(conn: &Connection, entity: Option<&str>) -> AppResult<Vec<NamedBalance>> {
    let mut stmt = conn.prepare("SELECT id, display_name FROM families ORDER BY display_name")?;
    let families = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
    let mut names = conn.prepare("SELECT first_name || ' ' || last_name FROM children WHERE id = ?1")?;
    let mut out = Vec::new();
    for (family_id, family_name) in families {
        for balance in child_balances(conn, &family_id)? {
            if entity.is_some_and(|e| e != balance.entity) {
                continue;
            }
            let child_name = match balance.child_id.as_deref() {
                Some(id) => names.query_row(params![id], |r| r.get(0)).optional()?.unwrap_or_default(),
                None => String::new(),
            };
            out.push(NamedBalance { family_id: family_id.clone(), family_name: family_name.clone(), child_name, balance });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    /// Family f: children c and d (IMH), invoices of c (IMH 710,00) and d (IMH 300,00), one IDSS invoice of c,
    /// and family g with child x.
    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO families(id, display_name, created_at) VALUES ('f', 'T', 'x'), ('g', 'U', 'x');
             INSERT INTO children(id, family_id, first_name, last_name, date_of_birth, residency, created_at)
               VALUES ('c', 'f', 'A', 'T', '2022-01-01', 'DOMESTIC', 'x'), ('d', 'f', 'B', 'T', '2023-01-01', 'DOMESTIC', 'x'),
                      ('x', 'g', 'C', 'U', '2022-01-01', 'DOMESTIC', 'x');
             INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, issue_date, due_date, period_from, period_to,
                                  total_fenings, status, created_at)
               VALUES ('ic', 'IMH-001/26', 'IMH', 'OTHER', 'f', 'c', 'B', '2026-11-01', '2026-11-05', '2026-11-01', '2026-11-30', 71000, 'ISSUED', 'x'),
                      ('id', 'IMH-002/26', 'IMH', 'OTHER', 'f', 'd', 'B', '2026-11-02', '2026-11-05', '2026-11-01', '2026-11-30', 30000, 'ISSUED', 'x'),
                      ('jc', 'IDSS-001/26', 'IDSS', 'OTHER', 'f', 'c', 'B', '2026-11-01', '2026-11-05', '2026-11-01', '2026-11-30', 50000, 'ISSUED', 'x'),
                      ('ix', 'IMH-003/26', 'IMH', 'OTHER', 'g', 'x', 'B', '2026-11-01', '2026-11-05', '2026-11-01', '2026-11-30', 10000, 'ISSUED', 'x');",
        )
        .unwrap();
        conn
    }

    fn input(id: &str, child: &str, amount: i64) -> PrepaymentInput {
        PrepaymentInput {
            id: id.into(),
            family_id: "f".into(),
            entity: "IMH".into(),
            child_id: child.into(),
            paid_on: "2026-10-20".into(),
            amount,
            payer_name: "Amir Begović".into(),
            payer_relation: "djed".into(),
            reference: "izvod 12".into(),
            note: "unaprijed".into(),
        }
    }

    fn card(conn: &Connection, entity: &str, child: Option<&str>) -> ChildBalance {
        child_balances(conn, "f")
            .unwrap()
            .into_iter()
            .find(|b| b.entity == entity && b.child_id.as_deref() == child)
            .unwrap_or(ChildBalance { entity: entity.into(), child_id: child.map(String::from), ..Default::default() })
    }

    fn identity(b: &ChildBalance) {
        assert_eq!(b.saldo, b.charged - b.received - b.transferred_in + b.transferred_out + b.refunded, "{b:?}");
    }

    fn pay(tx: &Transaction, id: &str, invoice: &str, amount: i64) {
        tx.execute(
            "INSERT INTO payments(id, invoice_id, paid_on, amount, payer_name, created_at) VALUES (?1, ?2, '2026-11-03', ?3, 'B', 'x')",
            params![id, invoice, amount],
        )
        .unwrap();
    }

    /// SPEC acceptance 1–2: a payment with no invoice is a prepayment (saldo negative); applied to a new invoice of
    /// the child it pays it; the rest stays prepaid; nothing of the other institution changes.
    #[test]
    fn a_payment_without_an_invoice_is_a_prepayment_and_pays_the_childs_invoice() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        record_prepayment(&tx, &input("p1", "c", 100000)).unwrap();
        let before = card(&tx, "IMH", Some("c"));
        assert_eq!((before.charged, before.prepaid, before.saldo), (71000, 100000, 71000 - 100000));
        identity(&before);
        assert_eq!(card(&tx, "IDSS", Some("c")).saldo, 50000, "IDSS untouched");
        use_prepaid(&tx, "f", "IMH", Some("c"), Some("ic"), 71000, "2026-11-04", "primjena pretplate", false).unwrap();
        assert_eq!(balance(&tx, "ic").unwrap(), (71000, 71000));
        let after = card(&tx, "IMH", Some("c"));
        assert_eq!((after.prepaid, after.saldo), (29000, -29000));
        identity(&after);
        let applied: i64 = tx
            .query_row(&format!("SELECT {} FROM invoices i WHERE i.id = 'ic'", crate::credit_notes::APPLIED_PREPAYMENT_SQL), [], |r| r.get(0))
            .unwrap();
        assert_eq!(applied, 71000, "the PDF line „Umanjeno za primljenu pretplatu“");
    }

    /// SPEC §5: what the database refuses.
    #[test]
    fn refusals() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        assert!(record_prepayment(&tx, &input("p0", "x", 1000)).is_err(), "child of another family");
        assert!(record_prepayment(&tx, &PrepaymentInput { payer_relation: " ".into(), ..input("p0", "c", 1000) }).is_err(), "relation");
        assert!(record_prepayment(&tx, &PrepaymentInput { payer_name: "Amir 2".into(), ..input("p0", "c", 1000) }).is_err(), "name");
        assert!(record_prepayment(&tx, &PrepaymentInput { entity: "XY".into(), ..input("p0", "c", 1000) }).is_err(), "entity");
        assert!(record_prepayment(&tx, &input("p0", "c", MAX_AMOUNT + 1)).is_err(), "above 100.000 KM");
        assert!(record_prepayment(&tx, &PrepaymentInput { paid_on: "2999-01-01".into(), ..input("p0", "c", 1000) }).is_err(), "future");
        record_prepayment(&tx, &input("p1", "c", 100000)).unwrap();
        let use_ = |child: Option<&str>, to: Option<&str>, amount: i64, sibling: bool, note: &str| {
            use_prepaid(&tx, "f", "IMH", child, to, amount, "2026-11-04", note, sibling)
        };
        assert!(use_(Some("c"), Some("jc"), 1000, false, "n").is_err(), "IMH money never pays IDSS");
        assert!(use_(Some("c"), Some("ix"), 1000, false, "n").is_err(), "other family");
        assert!(use_(Some("c"), Some("id"), 1000, false, "n").is_err(), "brother's invoice without the transfer");
        assert!(use_(Some("c"), Some("id"), 1000, true, " ").is_err(), "transfer without a note");
        assert!(use_(Some("c"), Some("ic"), 72000, false, "n").is_err(), "above what is open");
        assert!(use_(Some("c"), None, 100001, false, "povrat").is_err(), "refund above the prepayment");
        assert!(use_(Some("d"), Some("id"), 1000, false, "n").is_err(), "d has no prepayment");
        use_(Some("c"), Some("id"), 30000, true, "prenos na brata").unwrap();
        assert_eq!(balance(&tx, "id").unwrap(), (30000, 30000));
        let (c, d) = (card(&tx, "IMH", Some("c")), card(&tx, "IMH", Some("d")));
        assert_eq!((c.transferred_out, d.transferred_in, c.prepaid), (30000, 30000, 70000));
        identity(&c);
        identity(&d);
        // a credit note invoice and a cancelled one take no prepayment
        tx.execute("UPDATE invoices SET status = 'CANCELLED' WHERE id = 'ic'", []).unwrap();
        assert!(use_(Some("c"), Some("ic"), 1000, false, "n").is_err(), "cancelled");
    }

    /// Q4: an excess on an invoice (IMH-897/26: 1.000 KM due, 2.000 KM paid) is the child's prepayment; the invoice
    /// is paid, the child's saldo is −1.000,00 KM; the excess is used like any prepayment, oldest source first.
    #[test]
    fn an_excess_on_an_invoice_is_the_childs_prepayment_oldest_first() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        pay(&tx, "q1", "ic", 71000);
        pay(&tx, "q2", "ic", 71000);
        let c = card(&tx, "IMH", Some("c"));
        assert_eq!((c.prepaid, c.saldo), (71000, -71000));
        identity(&c);
        record_prepayment(&tx, &PrepaymentInput { paid_on: "2026-11-20".into(), ..input("p1", "c", 5000) }).unwrap();
        let s = sources(&tx, "f", "IMH", Some("c")).unwrap();
        assert_eq!(s.iter().map(|x| (x.kind.as_str(), x.remaining)).collect::<Vec<_>>(), vec![("EXCESS", 71000), ("PREPAYMENT", 5000)]);
        // a new invoice for c: 100,00 KM — the older excess pays first
        tx.execute_batch(
            "INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, issue_date, due_date, period_from, period_to,
                                  total_fenings, status, created_at)
             VALUES ('ic2', 'IMH-004/26', 'IMH', 'OTHER', 'f', 'c', 'B', '2026-12-01', '2026-12-05', '2026-12-01', '2026-12-31', 10000, 'ISSUED', 'x');",
        )
        .unwrap();
        use_prepaid(&tx, "f", "IMH", Some("c"), Some("ic2"), 10000, "2026-12-01", "primjena pretplate", false).unwrap();
        assert_eq!(balance(&tx, "ic").unwrap(), (71000, 132000), "2 × 710,00 paid, 100,00 of the excess used elsewhere");
        let s = sources(&tx, "f", "IMH", Some("c")).unwrap();
        assert_eq!(s.iter().map(|x| x.remaining).collect::<Vec<_>>(), vec![61000, 5000]);
        identity(&card(&tx, "IMH", Some("c")));
        // a refund of the excess lowers the prepayment; the payments themselves stay
        use_prepaid(&tx, "f", "IMH", Some("c"), None, 61000, "2026-12-02", "povrat roditelju", false).unwrap();
        let c = card(&tx, "IMH", Some("c"));
        assert_eq!((c.prepaid, c.refunded, c.saldo), (5000, 61000, -5000));
        identity(&c);
        let kept: i64 = tx.query_row("SELECT count(*) FROM payments", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 2);
    }

    /// S4 for prepayments: reversal needs a reason; a used prepayment cannot be reversed before its use is;
    /// nothing is ever deleted or changed in place.
    #[test]
    fn reversals_and_append_only() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        record_prepayment(&tx, &input("p1", "c", 20000)).unwrap();
        let uses = use_prepaid(&tx, "f", "IMH", Some("c"), Some("ic"), 20000, "2026-11-04", "primjena", false).unwrap();
        assert!(matches!(reverse_prepayment(&tx, "p1", "2026-11-05", "greška"), Err(AppError::Conflict(_))));
        assert!(reverse_use(&tx, &uses[0], "2026-11-05", " ").is_err(), "reason required");
        reverse_use(&tx, &uses[0], "2026-11-05", "pogrešan račun").unwrap();
        assert_eq!(balance(&tx, "ic").unwrap(), (71000, 0));
        assert!(matches!(reverse_use(&tx, &uses[0], "2026-11-05", "opet"), Err(AppError::Conflict(_))));
        reverse_prepayment(&tx, "p1", "2026-11-05", "uplata je za drugu porodicu").unwrap();
        let c = card(&tx, "IMH", Some("c"));
        assert_eq!((c.received, c.prepaid, c.saldo), (0, 0, 71000));
        identity(&c);
        assert!(tx.execute("DELETE FROM prepayments", []).is_err());
        assert!(tx.execute("UPDATE prepayment_uses SET amount = 1", []).is_err());
        assert!(tx.execute("DELETE FROM prepayment_use_reversals", []).is_err());
        let listed = list_prepayments(&tx, "f").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].reversal_reason.as_deref(), Some("uplata je za drugu porodicu"));
        assert_eq!(listed[0].uses[0].reversal_reason.as_deref(), Some("pogrešan račun"));
        // a payment whose money was passed on as excess cannot be reversed first (S4 + Q4)
        pay(&tx, "q1", "id", 60000);
        use_prepaid(&tx, "f", "IMH", Some("d"), None, 30000, "2026-11-06", "povrat", false).unwrap();
        assert!(matches!(crate::credit_notes::reverse_payment(&tx, "q1", "2026-11-07", "greška"), Err(AppError::Conflict(_))));
    }

    #[test]
    fn all_balances_by_institution_with_names() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        record_prepayment(&tx, &input("p1", "c", 100000)).unwrap();
        let imh = all_child_balances(&tx, Some("IMH")).unwrap();
        assert!(imh.iter().all(|b| b.balance.entity == "IMH"));
        let c = imh.iter().find(|b| b.balance.child_id.as_deref() == Some("c")).unwrap();
        assert_eq!((c.child_name.as_str(), c.balance.saldo), ("A T", 71000 - 100000));
        assert!(all_child_balances(&tx, None).unwrap().iter().any(|b| b.family_id == "g"), "other families too");
    }

    /// The fening identity holds for every card after random sequences of payments, prepayments, uses,
    /// refunds and reversals: nothing appears or disappears.
    #[test]
    fn money_is_conserved_for_random_sequences() {
        let mut seed: u64 = 0x2026_1128;
        let mut next = |n: u64| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) % n
        };
        for round in 0..40 {
            let mut conn = db();
            let tx = conn.transaction().unwrap();
            let mut uses: Vec<String> = Vec::new();
            for step in 0..30 {
                let child = if next(2) == 0 { "c" } else { "d" };
                let amount = (next(400) as i64 + 1) * 100;
                match next(6) {
                    0 => record_prepayment(&tx, &input(&format!("p{round}-{step}"), child, amount)).map(|_| ()),
                    1 => {
                        pay(&tx, &format!("q{round}-{step}"), if child == "c" { "ic" } else { "id" }, amount);
                        Ok(())
                    }
                    2 | 3 => {
                        let to = if next(3) == 0 { None } else if next(2) == 0 { Some("ic") } else { Some("id") };
                        let sibling = to.is_some() && next(2) == 0;
                        use_prepaid(&tx, "f", "IMH", Some(child), to, amount, "2026-11-10", "n", sibling).map(|ids| uses.extend(ids))
                    }
                    4 if !uses.is_empty() => reverse_use(&tx, &uses[next(uses.len() as u64) as usize].clone(), "2026-11-11", "r"),
                    _ => Ok(()),
                }
                .ok();
                for b in child_balances(&tx, "f").unwrap() {
                    identity(&b);
                    assert!(b.prepaid >= 0);
                }
                for inv in ["ic", "id"] {
                    assert!(balance(&tx, inv).unwrap().1 >= 0, "an invoice never has negative effective payments");
                }
            }
        }
    }
}
