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
    pub date_of_birth: String,
    pub residency: String,
    pub citizen_bih: bool,
    pub residence_ks: bool,
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
        "SELECT id, family_id, first_name, last_name, date_of_birth, residency, citizen_bih, residence_ks
         FROM children WHERE family_id = ?1 ORDER BY date_of_birth",
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

pub fn save_child(tx: &Transaction, c: &Child) -> AppResult<()> {
    let affected = tx.execute(
        "INSERT INTO children(id, family_id, first_name, last_name, date_of_birth, residency, citizen_bih, residence_ks, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
           date_of_birth = excluded.date_of_birth, residency = excluded.residency,
           citizen_bih = excluded.citizen_bih, residence_ks = excluded.residence_ks",
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

fn count(tx: &Transaction, sql: &str, id: &str) -> AppResult<i64> {
    Ok(tx.query_row(sql, params![id], |r| r.get(0))?)
}

/// Delete a child only when nothing references it (A-10: pre-check blockers, never cascade).
pub fn delete_child(tx: &Transaction, child_id: &str) -> AppResult<()> {
    let enrolments = count(tx, "SELECT count(*) FROM enrolments WHERE child_id = ?1", child_id)?;
    let decisions = count(tx, "SELECT count(*) FROM board_decisions WHERE child_id = ?1", child_id)?;
    if enrolments + decisions > 0 {
        return Err(AppError::Conflict(format!(
            "dijete ima {enrolments} upis(a) i {decisions} odluk(a) odbora — prvo ih uklonite ili ispišite dijete"
        )));
    }
    let affected = tx.execute("DELETE FROM children WHERE id = ?1", params![child_id])?;
    if affected != 1 {
        return Err(AppError::NotFound("dijete ne postoji".into()));
    }
    Ok(())
}

/// Delete an enrolment only while it is still awaiting enrolment payments; otherwise it must be withdrawn.
pub fn delete_enrolment(tx: &Transaction, enrolment_id: &str) -> AppResult<()> {
    let status: Option<String> = tx
        .query_row("SELECT status FROM enrolments WHERE id = ?1", params![enrolment_id], |r| r.get(0))
        .optional()?;
    match status.as_deref() {
        None => Err(AppError::NotFound("upis ne postoji".into())),
        Some("AWAITING_ENROLMENT_PAYMENT") => {
            tx.execute("DELETE FROM enrolments WHERE id = ?1", params![enrolment_id])?;
            Ok(())
        }
        Some(_) => Err(AppError::Conflict("aktivan upis se ne briše — koristite ispis".into())),
    }
}

/// Delete a family only when it has no children.
pub fn delete_family(tx: &Transaction, family_id: &str) -> AppResult<()> {
    let children = count(tx, "SELECT count(*) FROM children WHERE family_id = ?1", family_id)?;
    if children > 0 {
        return Err(AppError::Conflict(format!("porodica ima {children} djece — prvo obrišite djecu")));
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
            full_name: format!("Roditelj {id}"),
            role: "MOTHER".into(),
            email: "".into(),
            phone: "".into(),
            iban: "BA391990490058487943".into(),
            is_payer: payer,
        }
    }

    fn child(id: &str) -> Child {
        Child {
            id: id.into(),
            family_id: F.into(),
            first_name: "Ana".into(),
            last_name: "Test".into(),
            date_of_birth: "2021-03-01".into(),
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
        assert_eq!(summary[0].payer_name.as_deref(), Some("Roditelj g2"));
    }

    #[test]
    fn database_rejects_second_active_enrolment_in_same_entity() {
        let mut conn = db();
        let tx = conn.transaction().unwrap();
        save_family(&tx, &family(), &[guardian("g1", true)]).unwrap();
        save_child(&tx, &child("c1")).unwrap();
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
        assert!(matches!(delete_family(&tx, F), Err(AppError::Conflict(_))));
        assert!(matches!(delete_child(&tx, "c1"), Err(AppError::Conflict(_))));
        assert!(matches!(delete_enrolment(&tx, "e1"), Err(AppError::Conflict(_))));
        save_enrolment(&tx, &enrolment("e1", "TODDLERS", "AWAITING_ENROLMENT_PAYMENT")).unwrap();
        delete_enrolment(&tx, "e1").unwrap();
        delete_child(&tx, "c1").unwrap();
        delete_family(&tx, F).unwrap();
        assert!(matches!(delete_family(&tx, F), Err(AppError::NotFound(_))));
    }
}
