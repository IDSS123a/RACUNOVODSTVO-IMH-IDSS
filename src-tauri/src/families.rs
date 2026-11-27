//! SQL for families, guardians, children and enrolments (Commander A-3).
//! Business rules (payer, uniqueness, transitions) are validated in TypeScript
//! (`src/features/families/domain.ts`); the database adds CHECK / UNIQUE guards.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::repository::now;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Family {
    pub id: String,
    pub display_name: String,
    pub address: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Guardian {
    pub id: String,
    pub family_id: String,
    pub full_name: String,
    pub role: String,
    pub email: String,
    pub phone: String,
    pub iban: String,
    pub is_payer: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Child {
    pub id: String,
    pub family_id: String,
    pub first_name: String,
    pub last_name: String,
    /// None for children imported from the previous solution until the operator enters it (BR-32).
    pub date_of_birth: Option<String>,
    pub residency: String,
    pub citizen_bih: bool,
    pub residence_ks: bool,
    /// Imported data the operator still has to check (date of birth, residency); cleared on save.
    #[serde(default)]
    pub import_review: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Enrolment {
    pub id: String,
    pub child_id: String,
    pub program: String,
    pub school_year: String,
    pub starts_on: String,
    pub ends_on: Option<String>,
    pub status: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FamilySummary {
    pub id: String,
    pub display_name: String,
    pub child_count: i64,
    pub payer_name: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FamilyDetail {
    pub family: Family,
    pub guardians: Vec<Guardian>,
    pub children: Vec<Child>,
    pub enrolments: Vec<Enrolment>,
}

/// Map a UNIQUE / CHECK violation to a specific, friendly conflict (E-5: precise errors before generic).
fn constraint_to_conflict(error: rusqlite::Error, message: &str) -> AppError {
    match &error {
        rusqlite::Error::SqliteFailure(code, _) if code.code == rusqlite::ErrorCode::ConstraintViolation => {
            AppError::Conflict(message.into())
        }
        _ => AppError::Database(error),
    }
}

pub fn list_families(conn: &Connection) -> AppResult<Vec<FamilySummary>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.display_name,
                (SELECT count(*) FROM children c WHERE c.family_id = f.id),
                (SELECT g.full_name FROM guardians g WHERE g.family_id = f.id AND g.is_payer = 1)
         FROM families f ORDER BY f.display_name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(FamilySummary { id: r.get(0)?, display_name: r.get(1)?, child_count: r.get(2)?, payer_name: r.get(3)? })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// One enrolment of a school year without any name (dashboard counts, specs/dashboard-audit D1).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnrolmentOverview {
    pub family_id: String,
    pub child_id: String,
    pub program: String,
    pub status: String,
}

pub fn enrolment_overview(conn: &Connection, school_year: &str) -> AppResult<Vec<EnrolmentOverview>> {
    let mut stmt = conn.prepare(
        "SELECT c.family_id, e.child_id, e.program, e.status FROM enrolments e JOIN children c ON c.id = e.child_id
         WHERE e.school_year = ?1 ORDER BY e.id",
    )?;
    let rows = stmt.query_map(params![school_year], |r| {
        Ok(EnrolmentOverview { family_id: r.get(0)?, child_id: r.get(1)?, program: r.get(2)?, status: r.get(3)? })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_family(conn: &Connection, family_id: &str) -> AppResult<Option<FamilyDetail>> {
    let family = conn
        .query_row("SELECT id, display_name, address FROM families WHERE id = ?1", params![family_id], |r| {
            Ok(Family { id: r.get(0)?, display_name: r.get(1)?, address: r.get(2)? })
        })
        .optional()?;
    let Some(family) = family else { return Ok(None) };

    let mut stmt = conn.prepare(
        "SELECT id, family_id, full_name, role, email, phone, iban, is_payer FROM guardians
         WHERE family_id = ?1 ORDER BY is_payer DESC, full_name",
    )?;
    let guardians = stmt
        .query_map(params![family_id], |r| {
            Ok(Guardian {
                id: r.get(0)?,
                family_id: r.get(1)?,
                full_name: r.get(2)?,
                role: r.get(3)?,
                email: r.get(4)?,
                phone: r.get(5)?,
                iban: r.get(6)?,
                is_payer: r.get::<_, i64>(7)? == 1,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut stmt = conn.prepare(
        "SELECT id, family_id, first_name, last_name, date_of_birth, residency, citizen_bih, residence_ks, import_review
         FROM children WHERE family_id = ?1 ORDER BY date_of_birth IS NULL, date_of_birth, first_name",
    )?;
    let children = stmt
        .query_map(params![family_id], |r| {
            Ok(Child {
                id: r.get(0)?,
                family_id: r.get(1)?,
                first_name: r.get(2)?,
                last_name: r.get(3)?,
                date_of_birth: r.get(4)?,
                residency: r.get(5)?,
                citizen_bih: r.get::<_, i64>(6)? == 1,
                residence_ks: r.get::<_, i64>(7)? == 1,
                import_review: r.get::<_, i64>(8)? == 1,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut stmt = conn.prepare(
        "SELECT e.id, e.child_id, e.program, e.school_year, e.starts_on, e.ends_on, e.status
         FROM enrolments e JOIN children c ON c.id = e.child_id
         WHERE c.family_id = ?1 ORDER BY e.school_year DESC, e.starts_on",
    )?;
    let enrolments = stmt
        .query_map(params![family_id], |r| {
            Ok(Enrolment {
                id: r.get(0)?,
                child_id: r.get(1)?,
                program: r.get(2)?,
                school_year: r.get(3)?,
                starts_on: r.get(4)?,
                ends_on: r.get(5)?,
                status: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Some(FamilyDetail { family, guardians, children, enrolments }))
}

/// Save a family and replace its guardian list. Exactly one payer is checked here too (defence in depth).
pub fn save_family(tx: &Transaction, family: &Family, guardians: &[Guardian]) -> AppResult<()> {
    if guardians.iter().filter(|g| g.is_payer).count() != 1 {
        return Err(AppError::Validation("porodica mora imati tačno jednog platioca".into()));
    }
    if guardians.iter().any(|g| g.family_id != family.id) {
        return Err(AppError::Validation("roditelj pripada drugoj porodici".into()));
    }
    crate::formats::check_name(&family.display_name, "naziv porodice")?;
    // canonical formats, checked again on save (DL-P017); empty stays allowed
    for g in guardians {
        crate::formats::check_name(&g.full_name, "ime i prezime roditelja")?;
        crate::formats::check_phone(&g.phone, "telefon roditelja")?;
        crate::formats::check_email(&g.email, "e-mail roditelja")?;
        crate::formats::check_iban(&g.iban, "IBAN roditelja")?;
    }
    tx.execute(
        "INSERT INTO families(id, display_name, address, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, address = excluded.address",
        params![family.id, family.display_name, family.address, now()],
    )?;
    // WHY clear the payer flag first: the partial UNIQUE index allows one payer at a time,
    // so moving the payer role between guardians would otherwise collide mid-update.
    tx.execute("UPDATE guardians SET is_payer = 0 WHERE family_id = ?1", params![family.id])?;
    let keep: Vec<&str> = guardians.iter().map(|g| g.id.as_str()).collect();
    let existing: Vec<String> = tx
        .prepare("SELECT id FROM guardians WHERE family_id = ?1")?
        .query_map(params![family.id], |r| r.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for id in existing.iter().filter(|id| !keep.contains(&id.as_str())) {
        tx.execute("DELETE FROM guardians WHERE id = ?1", params![id])?;
    }
    for g in guardians {
        tx.execute(
            "INSERT INTO guardians(id, family_id, full_name, role, email, phone, iban, is_payer, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, role = excluded.role, email = excluded.email,
               phone = excluded.phone, iban = excluded.iban, is_payer = excluded.is_payer",
            params![g.id, g.family_id, g.full_name, g.role, g.email, g.phone, g.iban, g.is_payer as i64, now()],
        )?;
    }
    Ok(())
}

/// Ages (completed years) a child may have on the first day of a program; the same table as `PROGRAM_AGE` in
/// `src/features/families/domain.ts` (Director, 2026-11-22: a kindergarten child born in 1998 was accepted).
fn program_age(program: &str) -> Option<(i32, i32)> {
    match program {
        // Director, 2026-11-27: Toddlers until the 4th birthday, Preschoolers from the 2nd (SPEC A9)
        "TODDLERS" => Some((0, 3)),
        "PRESCHOOLERS" => Some((2, 6)),
        "IDSS_PRESCHOOLERS" => Some((3, 6)),
        "PRIMARY_1_4" => Some((5, 11)),
        "PRIMARY_5_9" => Some((9, 16)),
        _ => None,
    }
}

/// Completed years between two ISO dates.
fn age_on(date_of_birth: &str, date: &str) -> Option<i32> {
    let year = |d: &str| d.get(0..4).and_then(|y| y.parse::<i32>().ok());
    let (born, on) = (year(date_of_birth)?, year(date)?);
    let years = on - born;
    Some(if date.get(5..)? < date_of_birth.get(5..)? { years - 1 } else { years })
}

/// Oldest age of a child of the institutions on the day it is saved.
const CHILD_MAX_AGE: i32 = 16;

pub fn save_child(tx: &Transaction, c: &Child) -> AppResult<()> {
    crate::formats::check_name(&c.first_name, "ime djeteta")?;
    crate::formats::check_name(&c.last_name, "prezime djeteta")?;
    if let Some(dob) = c.date_of_birth.as_deref() {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        if dob > today.as_str() {
            return Err(AppError::Validation("datum rođenja ne može biti u budućnosti".into()));
        }
        if age_on(dob, &today).is_some_and(|age| age > CHILD_MAX_AGE) {
            return Err(AppError::Validation(format!("dijete bi imalo više od {CHILD_MAX_AGE} godina — provjerite datum rođenja")));
        }
    }
    let affected = tx.execute(
        "INSERT INTO children(id, family_id, first_name, last_name, date_of_birth, residency, citizen_bih, residence_ks, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
           date_of_birth = excluded.date_of_birth, residency = excluded.residency,
           citizen_bih = excluded.citizen_bih, residence_ks = excluded.residence_ks,
           import_review = 0",
        params![
            c.id, c.family_id, c.first_name, c.last_name, c.date_of_birth, c.residency,
            c.citizen_bih as i64, c.residence_ks as i64, now()
        ],
    )?;
    if affected != 1 {
        return Err(AppError::NotFound("dijete nije sačuvano".into()));
    }
    Ok(())
}

pub fn save_enrolment(tx: &Transaction, e: &Enrolment) -> AppResult<()> {
    let dob: Option<String> = tx
        .query_row("SELECT date_of_birth FROM children WHERE id = ?1", params![e.child_id], |r| r.get(0))
        .optional()?
        .flatten();
    if let (Some(dob), Some((min, max))) = (dob.as_deref(), program_age(&e.program)) {
        if let Some(age) = age_on(dob, &e.starts_on) {
            if age < min || age > max {
                return Err(AppError::Validation(format!(
                    "dijete ima {age} god. na dan početka — za ovaj program dozvoljeno je {min}–{max} god.; provjerite datum rođenja ili program"
                )));
            }
        }
    }
    tx.execute(
        "INSERT INTO enrolments(id, child_id, program, school_year, starts_on, ends_on, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET program = excluded.program, school_year = excluded.school_year,
           starts_on = excluded.starts_on, ends_on = excluded.ends_on, status = excluded.status",
        params![e.id, e.child_id, e.program, e.school_year, e.starts_on, e.ends_on, e.status, now()],
    )
    .map_err(|err| constraint_to_conflict(err, "dijete već ima aktivan upis u istoj ustanovi za tu školsku godinu"))?;
    Ok(())
}

/// Move an active IMH kindergarten enrolment to the other group from a day (SPEC registration-validation A9).
/// Only Toddlers ↔ Preschoolers; the child's age on that day must fit the new group. It is the same enrolment: no new
/// enrolment fee, deposit or materials, the same price, and issued invoices do not change.
pub fn change_enrolment_group(tx: &Transaction, enrolment_id: &str, program: &str, from: &str) -> AppResult<String> {
    if !matches!(program, "TODDLERS" | "PRESCHOOLERS") {
        return Err(AppError::Validation("grupa je Toddlers ili Preschoolers".into()));
    }
    let found: Option<(String, String, String, Option<String>)> = tx
        .query_row(
            "SELECT e.program, e.status, e.starts_on, c.date_of_birth FROM enrolments e JOIN children c ON c.id = e.child_id WHERE e.id = ?1",
            params![enrolment_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((current, status, starts_on, dob)) = found else { return Err(AppError::NotFound("upis ne postoji".into())) };
    if !matches!(current.as_str(), "TODDLERS" | "PRESCHOOLERS") {
        return Err(AppError::Validation("grupa se mijenja samo u IMH vrtiću (Toddlers / Preschoolers)".into()));
    }
    if current == program {
        return Err(AppError::Validation("dijete je već u toj grupi".into()));
    }
    if !matches!(status.as_str(), "AWAITING_ENROLMENT_PAYMENT" | "ACTIVE" | "WITHDRAWAL_NOTIFIED" | "SUSPENDED") {
        return Err(AppError::Validation("grupa se mijenja samo na aktivnom upisu".into()));
    }
    if from < starts_on.as_str() {
        return Err(AppError::Validation("promjena ne može biti prije početka upisa".into()));
    }
    if let (Some(dob), Some((min, max))) = (dob.as_deref(), program_age(program)) {
        if let Some(age) = age_on(dob, from) {
            if age < min || age > max {
                return Err(AppError::Validation(format!("dijete ima {age} god. na dan promjene — za ovu grupu dozvoljeno je {min}–{max} god.")));
            }
        }
    }
    tx.execute("UPDATE enrolments SET program = ?1 WHERE id = ?2", params![program, enrolment_id])?;
    Ok(current)
}

fn count(tx: &Transaction, sql: &str, id: &str) -> AppResult<i64> {
    Ok(tx.query_row(sql, params![id], |r| r.get(0))?)
}

/// The number of an issued invoice that bills this child or enrolment, if any. Accounting records are never deleted:
/// a billed child is withdrawn instead (BR-13–BR-15).
fn first_invoice_of(tx: &Transaction, child_id: Option<&str>, enrolment_id: Option<&str>) -> AppResult<Option<String>> {
    Ok(tx
        .query_row(
            "SELECT i.number FROM invoices i
             WHERE (?1 IS NOT NULL AND i.child_id = ?1)
                OR i.id IN (SELECT l.invoice_id FROM invoice_lines l
                            WHERE (?1 IS NOT NULL AND l.child_id = ?1) OR (?2 IS NOT NULL AND l.enrolment_id = ?2))
             ORDER BY i.issue_date LIMIT 1",
            params![child_id, enrolment_id],
            |r| r.get(0),
        )
        .optional()?)
}

/// Delete an enrolment entered by mistake (Director, 2026-11-21: deleting an entered item must work), whatever its
/// status, as long as it was never invoiced. Its payment plans (no instalment invoiced) and breakfast go with it.
pub fn delete_enrolment(tx: &Transaction, enrolment_id: &str) -> AppResult<()> {
    if count(tx, "SELECT count(*) FROM enrolments WHERE id = ?1", enrolment_id)? == 0 {
        return Err(AppError::NotFound("upis ne postoji".into()));
    }
    if let Some(number) = first_invoice_of(tx, None, Some(enrolment_id))? {
        return Err(AppError::Conflict(format!("upis je već fakturisan (račun {number}) — ne briše se, koristite ispis djeteta")));
    }
    let invoiced_plan = count(
        tx,
        "SELECT count(*) FROM payment_plan_items i JOIN payment_plans p ON p.id = i.plan_id
         WHERE p.enrolment_id = ?1 AND i.invoice_id IS NOT NULL",
        enrolment_id,
    )?;
    if invoiced_plan > 0 {
        return Err(AppError::Conflict("plan plaćanja ovog upisa ima fakturisane rate — ne briše se, koristite ispis".into()));
    }
    tx.execute(
        "DELETE FROM payment_plan_items WHERE plan_id IN (SELECT id FROM payment_plans WHERE enrolment_id = ?1)",
        params![enrolment_id],
    )?;
    tx.execute("DELETE FROM payment_plans WHERE enrolment_id = ?1", params![enrolment_id])?;
    tx.execute("DELETE FROM enrolment_breakfast WHERE enrolment_id = ?1", params![enrolment_id])?;
    tx.execute("DELETE FROM enrolments WHERE id = ?1", params![enrolment_id])?;
    Ok(())
}

/// Delete a child entered by mistake, with its never-invoiced enrolments, in one transaction.
/// A child with an invoice or a board decision is never deleted.
pub fn delete_child(tx: &Transaction, child_id: &str) -> AppResult<()> {
    if let Some(number) = first_invoice_of(tx, Some(child_id), None)? {
        return Err(AppError::Conflict(format!("dijete ima račun ({number}) — ne briše se, koristite ispis")));
    }
    let decisions = count(tx, "SELECT count(*) FROM board_decisions WHERE child_id = ?1", child_id)?;
    if decisions > 0 {
        return Err(AppError::Conflict(format!("dijete ima {decisions} odluk(a) odbora — ne briše se")));
    }
    let enrolments: Vec<String> = tx
        .prepare("SELECT id FROM enrolments WHERE child_id = ?1")?
        .query_map(params![child_id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for enrolment in &enrolments {
        delete_enrolment(tx, enrolment)?;
    }
    let affected = tx.execute("DELETE FROM children WHERE id = ?1", params![child_id])?;
    if affected != 1 {
        return Err(AppError::NotFound("dijete ne postoji".into()));
    }
    Ok(())
}

/// Delete a family entered by mistake, with its children and guardians, when none of it was ever invoiced.
pub fn delete_family(tx: &Transaction, family_id: &str) -> AppResult<()> {
    let invoiced: Option<String> = tx
        .query_row("SELECT number FROM invoices WHERE family_id = ?1 LIMIT 1", params![family_id], |r| r.get(0))
        .optional()?;
    if let Some(number) = invoiced {
        return Err(AppError::Conflict(format!("porodica ima račune ({number}) — ne briše se")));
    }
    let children: Vec<String> = tx
        .prepare("SELECT id FROM children WHERE family_id = ?1")?
        .query_map(params![family_id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for child in &children {
        delete_child(tx, child)?;
    }
    tx.execute("DELETE FROM guardians WHERE family_id = ?1", params![family_id])?;
    let affected = tx.execute("DELETE FROM families WHERE id = ?1", params![family_id])?;
    if affected != 1 {
        return Err(AppError::NotFound("porodica ne postoji".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    const F: &str = "00000000-0000-4000-8000-000000000001";

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        conn
    }

    fn guardian(id: &str, payer: bool) -> Guardian {
        Guardian {
            id: id.into(),
            family_id: F.into(),
            // a name of letters only (the backend refuses digits in a name, SPEC registration-validation A5)
            full_name: format!("Roditelj {}", id.chars().map(|c| if c.is_ascii_digit() { char::from(b'A' + (c as u8 - b'0')) } else { c }).collect::<String>()),
            role: "MOTHER".into(),
            email: "".into(),
            phone: "".into(),
            iban: "BA39 1990 4900 5848 7943".into(),
            is_payer: payer,
        }
    }

    fn child(id: &str) -> Child {
        Child {
            id: id.into(),
            family_id: F.into(),
            first_name: "Ana".into(),
            last_name: "Test".into(),
            date_of_birth: Some("2023-03-01".into()),
            import_review: false,
            residency: "DOMESTIC".into(),
            citizen_bih: true,
            residence_ks: false,
        }
    }

    fn enrolment(id: &str, program: &str, status: &str) -> Enrolment {
        Enrolment {
            id: id.into(),
            child_id: "c1".into(),
            program: program.into(),
            school_year: "2026/2027".into(),
            starts_on: "2026-09-01".into(),
            ends_on: None,
            status: status.into(),
        }
    }

    /// Director, 2026-11-22: a kindergarten enrolment for a child born in 1998 was accepted. The backend refuses a
    /// child older than 16 and an age that does not fit the program on its first day.
    #[test]
    fn date_of_birth_must_fit_the_child_and_the_program() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        save_family(&tx, &family(), &[guardian("g1", true)]).unwrap();
        let mut adult = child("c1");
        adult.date_of_birth = Some("1998-01-01".into());
        assert!(matches!(save_child(&tx, &adult), Err(AppError::Validation(_))));
        let mut future = child("c1");
        future.date_of_birth = Some("2999-01-01".into());
        assert!(save_child(&tx, &future).is_err());

        save_child(&tx, &child("c1")).unwrap(); // born 2023-03-01: 3 years old on 2026-09-01
        assert!(save_enrolment(&tx, &enrolment("e1", "PRESCHOOLERS", "ACTIVE")).is_ok());
        let err = save_enrolment(&tx, &enrolment("e2", "PRIMARY_5_9", "ACTIVE")).unwrap_err();
        assert!(matches!(err, AppError::Validation(ref m) if m.contains("3 god.")), "{err:?}");
        // an imported child without a date of birth is not judged here
        let mut unknown = child("c2");
        unknown.date_of_birth = None;
        save_child(&tx, &unknown).unwrap();
        let mut e = enrolment("e3", "PRIMARY_5_9", "ACTIVE");
        e.child_id = "c2".into();
        assert!(save_enrolment(&tx, &e).is_ok());
        assert_eq!((age_on("2020-09-02", "2026-09-01"), age_on("2020-09-01", "2026-09-01")), (Some(5), Some(6)));
    }

    /// SPEC A9: „Promijeni grupu“ moves Toddlers ↔ Preschoolers on the same enrolment, from a day, with the age
    /// checked on that day; nothing else can be changed this way.
    #[test]
    fn group_change_toddlers_preschoolers() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        save_family(&tx, &family(), &[guardian("g1", true)]).unwrap();
        save_child(&tx, &Child { date_of_birth: Some("2024-03-01".into()), ..child("c1") }).unwrap(); // 2 y 6 m on 2026-09-01
        save_enrolment(&tx, &enrolment("e1", "TODDLERS", "ACTIVE")).unwrap();
        assert_eq!(change_enrolment_group(&tx, "e1", "PRESCHOOLERS", "2026-10-01").unwrap(), "TODDLERS");
        let program: String = tx.query_row("SELECT program FROM enrolments WHERE id = 'e1'", [], |r| r.get(0)).unwrap();
        assert_eq!(program, "PRESCHOOLERS");
        // back to Toddlers on the 4th birthday is refused; before it, allowed
        assert!(change_enrolment_group(&tx, "e1", "TODDLERS", "2028-03-01").is_err());
        assert!(change_enrolment_group(&tx, "e1", "TODDLERS", "2026-11-01").is_ok());
        // before the start of the enrolment, to the same group, or to another program: refused
        assert!(change_enrolment_group(&tx, "e1", "PRESCHOOLERS", "2026-08-01").is_err());
        assert!(change_enrolment_group(&tx, "e1", "TODDLERS", "2026-11-02").is_err());
        assert!(change_enrolment_group(&tx, "e1", "PRIMARY_1_4", "2026-11-02").is_err());
        // a younger child (1 y 11 m) cannot be moved to Preschoolers
        save_child(&tx, &Child { id: "c2".into(), date_of_birth: Some("2024-10-01".into()), ..child("c2") }).unwrap();
        save_enrolment(&tx, &Enrolment { id: "e2".into(), child_id: "c2".into(), ..enrolment("e2", "TODDLERS", "ACTIVE") }).unwrap();
        assert!(change_enrolment_group(&tx, "e2", "PRESCHOOLERS", "2026-09-01").is_err());
        // a withdrawn enrolment keeps its group
        save_enrolment(&tx, &enrolment("e1", "TODDLERS", "WITHDRAWN")).unwrap();
        assert!(change_enrolment_group(&tx, "e1", "PRESCHOOLERS", "2026-12-01").is_err());
    }

    fn family() -> Family {
        Family { id: F.into(), display_name: "Test".into(), address: "Sarajevo".into() }
    }

    #[test]
    fn family_round_trip_and_payer_switch_e14() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        save_family(&tx, &family(), &[guardian("g1", true), guardian("g2", false)]).unwrap();
        save_child(&tx, &child("c1")).unwrap();
        save_enrolment(&tx, &enrolment("e1", "TODDLERS", "ACTIVE")).unwrap();
        // Switch the payer role — must not collide with the partial unique index.
        save_family(&tx, &family(), &[guardian("g1", false), guardian("g2", true)]).unwrap();
        tx.commit().unwrap();

        let detail = get_family(&conn, F).unwrap().unwrap();
        assert_eq!(detail.family, family());
        assert_eq!(detail.guardians, vec![guardian("g2", true), guardian("g1", false)]);
        assert_eq!(detail.children, vec![child("c1")]);
        assert_eq!(detail.enrolments, vec![enrolment("e1", "TODDLERS", "ACTIVE")]);
        let summary = list_families(&conn).unwrap();
        assert_eq!(summary[0].child_count, 1);
        assert_eq!(summary[0].payer_name.as_deref(), Some("Roditelj gC"));
    }

    #[test]
    fn database_rejects_second_active_enrolment_in_same_entity() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        save_family(&tx, &family(), &[guardian("g1", true)]).unwrap();
        // this test is about the database rule, not the age: a child without a date of birth (as imported)
        save_child(&tx, &Child { date_of_birth: None, ..child("c1") }).unwrap();
        save_enrolment(&tx, &enrolment("e1", "TODDLERS", "ACTIVE")).unwrap();
        let clash = save_enrolment(&tx, &enrolment("e2", "IDSS_PRESCHOOLERS", "ACTIVE"));
        assert!(matches!(clash, Err(AppError::Conflict(_))));
        // A school enrolment (IDSS) for the same child is allowed.
        save_enrolment(&tx, &enrolment("e3", "PRIMARY_1_4", "ACTIVE")).unwrap();
        // After withdrawal a new IMH enrolment is allowed.
        save_enrolment(&tx, &enrolment("e1", "TODDLERS", "WITHDRAWN")).unwrap();
        save_enrolment(&tx, &enrolment("e2", "IDSS_PRESCHOOLERS", "ACTIVE")).unwrap();
    }

    #[test]
    fn payer_rules_and_delete_blockers() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        assert!(save_family(&tx, &family(), &[guardian("g1", false)]).is_err());
        save_family(&tx, &family(), &[guardian("g1", true)]).unwrap();
        save_child(&tx, &child("c1")).unwrap();
        save_enrolment(&tx, &enrolment("e1", "TODDLERS", "ACTIVE")).unwrap();
        // Director 2026-11-21: an ACTIVE enrolment entered by mistake and never invoiced can be deleted
        delete_enrolment(&tx, "e1").unwrap();
        save_enrolment(&tx, &enrolment("e1", "TODDLERS", "ACTIVE")).unwrap();
        // a whole family entered by mistake goes in one step (children, enrolments, guardians)
        delete_family(&tx, F).unwrap();
        assert!(matches!(delete_family(&tx, F), Err(AppError::NotFound(_))));
        assert!(matches!(delete_enrolment(&tx, "e1"), Err(AppError::NotFound(_))));

        // once invoiced, nothing of it can be deleted
        save_family(&tx, &family(), &[guardian("g1", true)]).unwrap();
        save_child(&tx, &child("c1")).unwrap();
        save_enrolment(&tx, &enrolment("e1", "TODDLERS", "ACTIVE")).unwrap();
        tx.execute_batch(&format!(
            "INSERT INTO invoices(id, number, entity, kind, family_id, child_id, buyer_name, issue_date, due_date, period_from,
                                  period_to, total_fenings, status, created_at)
               VALUES ('i1', 'IMH-001/26', 'IMH', 'MONTHLY', '{F}', 'c1', 'B', '2026-10-01', '2026-10-05', '2026-10-01',
                       '2026-10-31', 100, 'ISSUED', 'x');
             INSERT INTO invoice_lines(id, invoice_id, position, item_code, description, child_id, enrolment_id, program,
                                       list_amount, amount)
               VALUES ('i1-1', 'i1', 1, 'TUITION', 'x', 'c1', 'e1', 'TODDLERS', 100, 100);"
        ))
        .unwrap();
        for result in [delete_enrolment(&tx, "e1"), delete_child(&tx, "c1"), delete_family(&tx, F)] {
            let error = result.unwrap_err();
            assert!(matches!(error, AppError::Conflict(_)) && error.to_string().contains("IMH-001/26"), "{error}");
        }
    }
}
