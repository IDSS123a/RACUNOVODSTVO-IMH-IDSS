//! SQL for Sprint 01 entities (Commander A-3: all queries live here, no business logic).
//! Field names are camelCase on the wire to match `src/lib/validation/schemas.ts`.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Institution {
    pub code: String,
    pub full_name: String,
    pub short_name: String,
    pub address: String,
    pub phone: String,
    pub fax: String,
    pub mobile: String,
    pub email: String,
    pub website: String,
    pub tax_id: String,
    pub registration_number: String,
    pub bank_name: String,
    pub bank_account: String,
    pub iban: String,
    pub swift: String,
    /// Printed on every invoice (PDV / tax note); entered by the operator, empty by default.
    #[serde(default)]
    pub invoice_note: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PriceListItem {
    pub school_year: String,
    pub program: String,
    pub item: String,
    pub residency: String,
    pub tier: String,
    pub basis: String,
    pub amount: i64,
    pub source: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MinistryApproval {
    pub school_year: String,
    pub document_number: String,
    pub document_date: String,
    pub note: String,
}

pub fn now() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string()
}

/// Append an audit entry. `details` must never contain personal data (BR-22).
pub fn audit(tx: &Transaction, action: &str, entity: &str, entity_id: &str, details: &str) -> AppResult<()> {
    tx.execute(
        "INSERT INTO audit_log(at, action, entity, entity_id, details) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![now(), action, entity, entity_id, details],
    )?;
    Ok(())
}

// ---------- institutions ----------

pub fn list_institutions(conn: &Connection) -> AppResult<Vec<Institution>> {
    let mut stmt = conn.prepare(
        "SELECT code, full_name, short_name, address, phone, fax, mobile, email, website, tax_id,
                registration_number, bank_name, bank_account, iban, swift, invoice_note
         FROM legal_entities ORDER BY code DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Institution {
            code: r.get(0)?,
            full_name: r.get(1)?,
            short_name: r.get(2)?,
            address: r.get(3)?,
            phone: r.get(4)?,
            fax: r.get(5)?,
            mobile: r.get(6)?,
            email: r.get(7)?,
            website: r.get(8)?,
            tax_id: r.get(9)?,
            registration_number: r.get(10)?,
            bank_name: r.get(11)?,
            bank_account: r.get(12)?,
            iban: r.get(13)?,
            swift: r.get(14)?,
            invoice_note: r.get(15)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Insert or update an institution; returns the number of affected rows (A-3: check it).
pub fn upsert_institution(tx: &Transaction, i: &Institution) -> AppResult<usize> {
    let affected = tx.execute(
        "INSERT INTO legal_entities(code, full_name, short_name, address, phone, fax, mobile, email, website,
                                    tax_id, registration_number, bank_name, bank_account, iban, swift, updated_at, invoice_note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(code) DO UPDATE SET
           full_name=excluded.full_name, short_name=excluded.short_name, address=excluded.address,
           phone=excluded.phone, fax=excluded.fax, mobile=excluded.mobile, email=excluded.email,
           website=excluded.website, tax_id=excluded.tax_id, registration_number=excluded.registration_number,
           bank_name=excluded.bank_name, bank_account=excluded.bank_account, iban=excluded.iban,
           swift=excluded.swift, updated_at=excluded.updated_at, invoice_note=excluded.invoice_note",
        params![
            i.code, i.full_name, i.short_name, i.address, i.phone, i.fax, i.mobile, i.email, i.website,
            i.tax_id, i.registration_number, i.bank_name, i.bank_account, i.iban, i.swift, now(), i.invoice_note
        ],
    )?;
    if affected != 1 {
        return Err(AppError::Conflict(format!("institution {} was not saved", i.code)));
    }
    Ok(affected)
}

// ---------- price lists ----------

pub fn count_price_items(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT count(*) FROM price_list_items", [], |r| r.get(0))?)
}

pub fn list_price_items(conn: &Connection, school_year: Option<&str>) -> AppResult<Vec<PriceListItem>> {
    let mut stmt = conn.prepare(
        "SELECT school_year, program, item, residency, tier, basis, amount_fenings, source
         FROM price_list_items
         WHERE (?1 IS NULL OR school_year = ?1)
         ORDER BY school_year DESC, id",
    )?;
    let rows = stmt.query_map(params![school_year], |r| {
        Ok(PriceListItem {
            school_year: r.get(0)?,
            program: r.get(1)?,
            item: r.get(2)?,
            residency: r.get(3)?,
            tier: r.get(4)?,
            basis: r.get(5)?,
            amount: r.get(6)?,
            source: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn insert_price_item(tx: &Transaction, p: &PriceListItem) -> AppResult<()> {
    tx.execute(
        "INSERT INTO price_list_items(school_year, program, item, residency, tier, basis, amount_fenings, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![p.school_year, p.program, p.item, p.residency, p.tier, p.basis, p.amount, p.source],
    )?;
    Ok(())
}

pub fn list_school_years(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT DISTINCT school_year FROM price_list_items ORDER BY school_year DESC")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// ---------- ministry approvals ----------

pub fn list_ministry_approvals(conn: &Connection) -> AppResult<Vec<MinistryApproval>> {
    let mut stmt = conn.prepare(
        "SELECT school_year, document_number, document_date, note FROM ministry_approvals ORDER BY school_year DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(MinistryApproval {
            school_year: r.get(0)?,
            document_number: r.get(1)?,
            document_date: r.get(2)?,
            note: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn upsert_ministry_approval(tx: &Transaction, a: &MinistryApproval) -> AppResult<()> {
    tx.execute(
        "INSERT INTO ministry_approvals(school_year, document_number, document_date, note, recorded_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(school_year) DO UPDATE SET document_number=excluded.document_number,
           document_date=excluded.document_date, note=excluded.note, recorded_at=excluded.recorded_at",
        params![a.school_year, a.document_number, a.document_date, a.note, now()],
    )?;
    Ok(())
}

// ---------- settings ----------

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value_json FROM settings WHERE key = ?1", params![key], |r| r.get(0))
        .optional()?)
}

pub fn set_setting(tx: &Transaction, key: &str, value_json: &str) -> AppResult<()> {
    tx.execute(
        "INSERT INTO settings(key, value_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
        params![key, value_json, now()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        conn
    }

    fn institution() -> Institution {
        Institution {
            code: "IDSS".into(),
            full_name: "Privatna ustanova".into(),
            short_name: "IDSS".into(),
            address: "Buka 13".into(),
            phone: "1".into(),
            fax: "".into(),
            mobile: "".into(),
            email: "info@idss.ba".into(),
            website: "www.idss.edu.ba".into(),
            tax_id: "4202220420007".into(),
            registration_number: "65-05-0013-16".into(),
            bank_name: "Sparkasse".into(),
            bank_account: "1994990021809884".into(),
            iban: "BA391994990021809884".into(),
            swift: "ABSBBA22".into(),
            invoice_note: "Napomena za test".into(),
        }
    }

    #[test]
    fn institution_round_trip_e14() {
        let mut conn = db();
        let original = institution();
        let tx = conn.transaction().unwrap();
        upsert_institution(&tx, &original).unwrap();
        tx.commit().unwrap();
        assert_eq!(list_institutions(&conn).unwrap(), vec![original]);
    }

    #[test]
    fn price_item_round_trip_e14() {
        let mut conn = db();
        let original = PriceListItem {
            school_year: "2026/2027".into(),
            program: "TODDLERS".into(),
            item: "TUITION".into(),
            residency: "DOMESTIC".into(),
            tier: "FIRST".into(),
            basis: "MONTHLY".into(),
            amount: 71000,
            source: "IMH Pravilnik".into(),
        };
        let tx = conn.transaction().unwrap();
        insert_price_item(&tx, &original).unwrap();
        tx.commit().unwrap();
        assert_eq!(list_price_items(&conn, Some("2026/2027")).unwrap(), vec![original.clone()]);
        assert!(list_price_items(&conn, Some("2025/2026")).unwrap().is_empty());
        assert_eq!(list_school_years(&conn).unwrap(), vec!["2026/2027".to_string()]);
    }

    #[test]
    fn approval_and_setting_round_trip_e14() {
        let mut conn = db();
        let approval = MinistryApproval {
            school_year: "2026/2027".into(),
            document_number: "11-04-1/26".into(),
            document_date: "2026-05-01".into(),
            note: "".into(),
        };
        let tx = conn.transaction().unwrap();
        upsert_ministry_approval(&tx, &approval).unwrap();
        set_setting(&tx, "app", "{\"a\":1}").unwrap();
        tx.commit().unwrap();
        assert_eq!(list_ministry_approvals(&conn).unwrap(), vec![approval]);
        assert_eq!(get_setting(&conn, "app").unwrap().as_deref(), Some("{\"a\":1}"));
        assert_eq!(get_setting(&conn, "missing").unwrap(), None);
    }
}
