//! Encrypted local storage (DL-P004).
//!
//! The SQLite database lives in memory. After every committed write the whole
//! database is serialised, encrypted (AES-256-GCM) and atomically written to disk
//! (temp file + rename; the previous snapshot is kept as `.prev`). Nothing about
//! children or parents ever touches the disk in clear text.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, Transaction, MAIN_DB};

use crate::crypto::{self, DataKey};
use crate::error::{AppError, AppResult};
use crate::keystore;
use crate::migrations;

const DB_FILE: &str = "fakturisanje.db.enc";
const KEY_FILE: &str = "database.key";

struct Inner {
    conn: Connection,
    key: DataKey,
    db_path: PathBuf,
    key_path: PathBuf,
    first_run: bool,
}

/// Thread-safe handle to the encrypted database, managed as Tauri state.
pub struct Store {
    inner: Mutex<Inner>,
}

/// Status reported to the UI.
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    pub ready: bool,
    pub first_run: bool,
    pub database_path: String,
    pub schema_version: i64,
}

impl Store {
    /// Open (or create) the encrypted database in `data_dir` and apply migrations.
    pub fn open(data_dir: &Path) -> AppResult<Self> {
        fs::create_dir_all(data_dir)?;
        let key_path = data_dir.join(KEY_FILE);
        let db_path = data_dir.join(DB_FILE);
        let (key, key_created) = keystore::load_or_create(&key_path)?;

        if key_created && db_path.exists() {
            // A database without its key cannot be opened; refuse to overwrite it.
            return Err(AppError::KeyStore(
                "pronađena je baza bez ključa — vratite ključ pomoću ključa za oporavak".into(),
            ));
        }

        let conn = if db_path.exists() {
            let file = fs::read(&db_path)?;
            load_snapshot(&key, &file)?
        } else {
            Connection::open_in_memory()?
        };

        let mut inner = Inner { conn, key, db_path, key_path, first_run: key_created };
        migrations::apply(&mut inner.conn)?;
        persist(&inner)?;
        Ok(Self { inner: Mutex::new(inner) })
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Inner>> {
        self.inner.lock().map_err(|_| AppError::Conflict("database lock poisoned".into()))
    }

    /// Run a read-only operation.
    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let inner = self.lock()?;
        f(&inner.conn)
    }

    /// Run a write in one transaction, then persist the encrypted snapshot.
    pub fn write<T>(&self, f: impl FnOnce(&Transaction) -> AppResult<T>) -> AppResult<T> {
        let mut inner = self.lock()?;
        let tx = inner.conn.transaction()?;
        let result = f(&tx)?;
        tx.commit()?;
        persist(&inner)?;
        Ok(result)
    }

    pub fn status(&self) -> AppResult<DatabaseStatus> {
        let inner = self.lock()?;
        Ok(DatabaseStatus {
            ready: true,
            first_run: inner.first_run,
            database_path: inner.db_path.display().to_string(),
            schema_version: migrations::current_version(&inner.conn)?,
        })
    }

    /// The recovery string for the current key (shown to the operator on first run).
    pub fn recovery_key(&self) -> AppResult<String> {
        let inner = self.lock()?;
        Ok(keystore::to_recovery_string(&inner.key))
    }

    /// Encrypted snapshot of the current database (used for backups).
    pub fn encrypted_snapshot(&self) -> AppResult<Vec<u8>> {
        let inner = self.lock()?;
        let plain = inner.conn.serialize(MAIN_DB)?;
        crypto::encrypt(&inner.key, &plain)
    }

    /// Replace the database with a backup file. The backup is decrypted with the current
    /// key or, if that fails and a recovery key is given, with the recovery key (which then
    /// becomes the current key). The current database is kept as `.before-restore`.
    pub fn restore(&self, backup: &[u8], recovery_key: Option<&str>) -> AppResult<()> {
        let mut inner = self.lock()?;
        let (conn, new_key) = match load_snapshot(&inner.key, backup) {
            Ok(conn) => (conn, None),
            Err(first_error) => match recovery_key {
                Some(text) => {
                    let key = keystore::from_recovery_string(text)?;
                    (load_snapshot(&key, backup)?, Some(key))
                }
                None => return Err(first_error),
            },
        };
        let mut conn = conn;
        migrations::validate_restorable(&conn)?;
        migrations::apply(&mut conn)?;

        if inner.db_path.exists() {
            fs::copy(&inner.db_path, inner.db_path.with_extension("before-restore"))?;
        }
        if let Some(key) = new_key {
            keystore::save(&inner.key_path, &key)?;
            inner.key = key;
        }
        inner.conn = conn;
        persist(&inner)?;
        Ok(())
    }
}

/// Decrypt a snapshot into a fresh in-memory connection.
fn load_snapshot(key: &DataKey, file: &[u8]) -> AppResult<Connection> {
    let plain = crypto::decrypt(key, file)?;
    let mut conn = Connection::open_in_memory()?;
    conn.deserialize_read_exact(MAIN_DB, plain.as_slice(), plain.len(), false)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

/// Serialise, encrypt and atomically write the database; keep the previous file as `.prev`.
fn persist(inner: &Inner) -> AppResult<()> {
    let plain = inner.conn.serialize(MAIN_DB)?;
    let file = crypto::encrypt(&inner.key, &plain)?;
    let tmp = inner.db_path.with_extension("tmp");
    fs::write(&tmp, &file)?;
    if inner.db_path.exists() {
        fs::copy(&inner.db_path, inner.db_path.with_extension("prev"))?;
    }
    fs::rename(&tmp, &inner.db_path)?;
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn create_write_reopen_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        {
            let store = Store::open(dir.path()).unwrap();
            assert!(store.status().unwrap().first_run);
            store
                .write(|tx| {
                    tx.execute(
                        "INSERT INTO settings(key, value_json, updated_at) VALUES ('k', '\"v\"', 'now')",
                        [],
                    )?;
                    Ok(())
                })
                .unwrap();
        }
        let reopened = Store::open(dir.path()).unwrap();
        assert!(!reopened.status().unwrap().first_run);
        let value: String = reopened
            .read(|c| Ok(c.query_row("SELECT value_json FROM settings WHERE key='k'", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(value, "\"v\"");
    }

    #[test]
    fn file_on_disk_is_not_plain_sqlite() {
        let dir = tempfile::tempdir().unwrap();
        let _store = Store::open(dir.path()).unwrap();
        let bytes = fs::read(dir.path().join(DB_FILE)).unwrap();
        assert!(!bytes.starts_with(b"SQLite format 3"));
        assert!(Connection::open(dir.path().join(DB_FILE))
            .and_then(|c| c.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)))
            .is_err());
    }

    #[test]
    fn restore_with_recovery_key_on_new_machine() {
        let source = tempfile::tempdir().unwrap();
        let store = Store::open(source.path()).unwrap();
        store
            .write(|tx| {
                tx.execute("INSERT INTO families(id, display_name, created_at) VALUES ('f1','Test','now')", [])?;
                Ok(())
            })
            .unwrap();
        let backup = store.encrypted_snapshot().unwrap();
        let recovery = store.recovery_key().unwrap();

        let target = tempfile::tempdir().unwrap();
        let other = Store::open(target.path()).unwrap();
        assert!(other.restore(&backup, None).is_err(), "different key must not open the backup");
        other.restore(&backup, Some(&recovery)).unwrap();
        let count: i64 = other
            .read(|c| Ok(c.query_row("SELECT count(*) FROM families", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(count, 1);
        drop(other);
        let reopened = Store::open(target.path()).unwrap();
        let count_after: i64 = reopened
            .read(|c| Ok(c.query_row("SELECT count(*) FROM families", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(count_after, 1, "recovered key must replace the local key");
    }
}

/// Tauri state wrapper: the app starts even if the database cannot be opened, so the UI
/// can show the reason (e.g. a missing key) instead of crashing (E-5).
pub struct AppStore(Result<Store, String>);

impl AppStore {
    pub fn new(result: AppResult<Store>) -> Self {
        Self(result.map_err(|e| e.to_string()))
    }

    pub fn get(&self) -> AppResult<&Store> {
        self.0.as_ref().map_err(|reason| AppError::KeyStore(reason.clone()))
    }
}
