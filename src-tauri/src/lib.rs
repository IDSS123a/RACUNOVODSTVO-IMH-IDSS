//! Fakturisanje IMH & IDSS — Tauri backend.
//! Layers (DL-P001): commands (Application) → repository (Infrastructure, SQL)
//! → store (encrypted SQLite) → crypto/keystore. Business rules live in TypeScript
//! (`src/features/*/domain`), never here.

mod commands;
mod crypto;
mod error;
mod families;
mod keystore;
mod migrations;
mod repository;
mod store;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build(),
                )?;
            }
            let data_dir = app.path().app_data_dir()?;
            let opened = store::Store::open(&data_dir);
            if let Err(error) = &opened {
                // No personal data in this message — only the technical reason (BR-22).
                log::error!("database could not be opened: {error}");
            }
            app.manage(store::AppStore::new(opened));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_status,
            commands::get_recovery_key,
            commands::acknowledge_recovery_key,
            commands::seed_reference_data,
            commands::list_institutions,
            commands::save_institution,
            commands::list_price_items,
            commands::list_school_years,
            commands::list_ministry_approvals,
            commands::save_ministry_approval,
            commands::get_settings,
            commands::save_settings,
            commands::create_backup,
            commands::restore_backup,
            commands::list_families,
            commands::get_family,
            commands::save_family,
            commands::save_child,
            commands::save_enrolment,
            commands::delete_child,
            commands::delete_enrolment,
            commands::delete_family,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Tauri application");
}
