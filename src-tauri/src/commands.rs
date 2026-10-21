//! Tauri commands — the Application layer boundary (Commander E-6 translated per DL-P002):
//! validate → execute → persist → return. Every write is audited.
//! Inputs are additionally validated with Zod on the TypeScript side (E-2).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::repository::{self as repo, Institution, MinistryApproval, PriceListItem};
use crate::store::{AppStore, DatabaseStatus};

const SETTINGS_KEY: &str = "app";
const RECOVERY_ACK_KEY: &str = "recovery_key_acknowledged";
const BACKUP_EXTENSION: &str = "fkbak";

/// GET status of the encrypted database.
#[tauri::command]
pub fn db_status(state: State<'_, AppStore>) -> AppResult<DatabaseStatus> {
    let store = state.get()?;
    store.status()
}

/// Recovery key — returned only until the operator confirms it was stored safely.
#[tauri::command]
pub fn get_recovery_key(state: State<'_, AppStore>) -> AppResult<Option<String>> {
    let store = state.get()?;
    let acknowledged = store.read(|c| repo::get_setting(c, RECOVERY_ACK_KEY))?.is_some();
    if acknowledged {
        return Ok(None);
    }
    Ok(Some(store.recovery_key()?))
}

#[tauri::command]
pub fn acknowledge_recovery_key(state: State<'_, AppStore>) -> AppResult<()> {
    let store = state.get()?;
    store.write(|tx| {
        repo::set_setting(tx, RECOVERY_ACK_KEY, "true")?;
        repo::audit(tx, "ACKNOWLEDGE", "recovery_key", "", "")
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceData {
    pub institutions: Vec<Institution>,
    pub price_items: Vec<PriceListItem>,
}

/// Seed institutions and price lists on first run. Idempotent: does nothing if data exists.
/// Returns true when seeding happened.
#[tauri::command]
pub fn seed_reference_data(state: State<'_, AppStore>, data: ReferenceData) -> AppResult<bool> {
    let store = state.get()?;
    if data.institutions.is_empty() || data.price_items.is_empty() {
        return Err(AppError::Validation("reference data must not be empty".into()));
    }
    store.write(|tx| {
        if repo::count_price_items(tx)? > 0 {
            return Ok(false);
        }
        for institution in &data.institutions {
            repo::upsert_institution(tx, institution)?;
        }
        for item in &data.price_items {
            repo::insert_price_item(tx, item)?;
        }
        repo::audit(
            tx,
            "SEED",
            "reference_data",
            "",
            &format!("{} institutions, {} price items", data.institutions.len(), data.price_items.len()),
        )?;
        Ok(true)
    })
}

#[tauri::command]
pub fn list_institutions(state: State<'_, AppStore>) -> AppResult<Vec<Institution>> {
    let store = state.get()?;
    store.read(repo::list_institutions)
}

#[tauri::command]
pub fn save_institution(state: State<'_, AppStore>, institution: Institution) -> AppResult<()> {
    let store = state.get()?;
    if institution.code != "IMH" && institution.code != "IDSS" {
        return Err(AppError::Validation("unknown legal entity".into()));
    }
    store.write(|tx| {
        repo::upsert_institution(tx, &institution)?;
        repo::audit(tx, "UPDATE", "legal_entity", &institution.code, "")
    })
}

#[tauri::command]
pub fn list_price_items(state: State<'_, AppStore>, school_year: Option<String>) -> AppResult<Vec<PriceListItem>> {
    let store = state.get()?;
    store.read(|c| repo::list_price_items(c, school_year.as_deref()))
}

#[tauri::command]
pub fn list_school_years(state: State<'_, AppStore>) -> AppResult<Vec<String>> {
    let store = state.get()?;
    store.read(repo::list_school_years)
}

#[tauri::command]
pub fn list_ministry_approvals(state: State<'_, AppStore>) -> AppResult<Vec<MinistryApproval>> {
    let store = state.get()?;
    store.read(repo::list_ministry_approvals)
}

#[tauri::command]
pub fn save_ministry_approval(state: State<'_, AppStore>, approval: MinistryApproval) -> AppResult<()> {
    let store = state.get()?;
    if approval.document_number.trim().is_empty() {
        return Err(AppError::Validation("broj akta je obavezan".into()));
    }
    store.write(|tx| {
        repo::upsert_ministry_approval(tx, &approval)?;
        repo::audit(tx, "UPSERT", "ministry_approval", &approval.school_year, "")
    })
}

/// Settings are stored as one JSON document validated by Zod on the frontend.
#[tauri::command]
pub fn get_settings(state: State<'_, AppStore>) -> AppResult<Option<serde_json::Value>> {
    let store = state.get()?;
    let raw = store.read(|c| repo::get_setting(c, SETTINGS_KEY))?;
    raw.map(|text| serde_json::from_str(&text).map_err(AppError::from)).transpose()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppStore>, settings: serde_json::Value) -> AppResult<()> {
    let store = state.get()?;
    if !settings.is_object() {
        return Err(AppError::Validation("settings must be an object".into()));
    }
    let text = serde_json::to_string(&settings)?;
    // WHY no details: settings contain the operator's personal data (BR-22).
    store.write(|tx| {
        repo::set_setting(tx, SETTINGS_KEY, &text)?;
        repo::audit(tx, "UPDATE", "settings", SETTINGS_KEY, "")
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub file_path: String,
    pub bytes: u64,
    pub created_at: String,
}

/// Write an encrypted backup into `folder` (must exist).
#[tauri::command]
pub fn create_backup(state: State<'_, AppStore>, folder: String) -> AppResult<BackupResult> {
    let store = state.get()?;
    let dir = PathBuf::from(&folder);
    if !dir.is_dir() {
        return Err(AppError::NotFound("folder za rezervne kopije ne postoji".into()));
    }
    let created_at = repo::now();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let path = dir.join(format!("fakturisanje-{stamp}.{BACKUP_EXTENSION}"));
    let bytes = store.encrypted_snapshot()?;
    fs::write(&path, &bytes)?;
    store.write(|tx| repo::audit(tx, "BACKUP", "database", "", ""))?;
    Ok(BackupResult { file_path: path.display().to_string(), bytes: bytes.len() as u64, created_at })
}

/// Restore an encrypted backup. A recovery key is needed only for backups made under another key.
#[tauri::command]
pub fn restore_backup(state: State<'_, AppStore>, file_path: String, recovery_key: Option<String>) -> AppResult<()> {
    let store = state.get()?;
    let bytes = fs::read(&file_path)?;
    store.restore(&bytes, recovery_key.as_deref())?;
    store.write(|tx| repo::audit(tx, "RESTORE", "database", "", ""))
}
