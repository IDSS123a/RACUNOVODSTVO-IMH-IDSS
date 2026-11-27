//! Encrypted local storage (DL-P004).
//!
//! The SQLite database lives in memory. After every committed write the whole
//! database is serialised, encrypted (AES-256-GCM) and atomically written to disk
//! (temp file + rename; the previous snapshot is kept as `.prev`). Nothing about
//! children or parents ever touches the disk in clear text.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, Transaction, MAIN_DB};

use crate::crypto::{self, DataKey};
use crate::error::{AppError, AppResult};
use crate::keystore;
use crate::migrations;

const DB_FILE: &str = "fakturisanje.db.enc";
const KEY_FILE: &str = "database.key";
const LOCK_FILE: &str = "fakturisanje.lock";

/// Shown to the operator when a second copy of the application is started (DL-P010).
pub const ALREADY_RUNNING_MESSAGE: &str =
    "Aplikacija je već otvorena u drugom prozoru. Koristite taj prozor, a ovaj zatvorite — dvije otvorene aplikacije bi prepisivale jedna drugoj podatke.";

/// Hold an exclusive lock on the data folder for the lifetime of the process (DL-P010).
/// The database lives in memory and is written to disk as a whole snapshot, so two running
/// instances would silently overwrite each other's invoices and could hand out the same number.
/// Windows releases the lock when the process ends, also after a crash — there is no stale lock.
fn acquire_instance_lock(data_dir: &Path) -> AppResult<fs::File> {
    let path = data_dir.join(LOCK_FILE);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const ERROR_SHARING_VIOLATION: i32 = 32;
        match fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).share_mode(0).open(&path) {
            Ok(file) => Ok(file),
            Err(error) if error.raw_os_error() == Some(ERROR_SHARING_VIOLATION) => {
                Err(AppError::AlreadyRunning(ALREADY_RUNNING_MESSAGE.into()))
            }
            Err(error) => Err(error.into()),
        }
    }
    #[cfg(not(windows))]
    {
        // The application targets Windows only (DL-P001); elsewhere the file exists without a lock.
        Ok(fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&path)?)
    }
}

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
    /// Exclusive lock on the data folder; released when the Store (the process) goes away.
    _instance_lock: fs::File,
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
        // First, before the key or the database is touched: only one instance may own the data.
        let instance_lock = acquire_instance_lock(data_dir)?;
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
        Ok(Self { inner: Mutex::new(inner), _instance_lock: instance_lock })
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Inner>> {
        self.inner.lock().map_err(|_| AppError::Conflict("database lock poisoned".into()))
    }

    /// Run a read-only operation.
    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let inner = self.lock()?;
        f(&inner.conn)
    }

    /// Run a write in one transaction, then put it on disk before the caller hears it succeeded.
    ///
    /// DL-P029 (2026-11-27): the snapshot used to be serialised INSIDE the open transaction. For a database loaded
    /// from disk (deserialised, every start but the first), SQLite serialises the committed pages only, so the
    /// change being made was missing from the file: the disk was always one write behind, and the last change
    /// before closing the app was lost (an issued invoice, IMH-907/26, was gone after a restart).
    ///
    /// Now: commit in memory, then write the snapshot of the committed state. If the disk write fails, memory is
    /// put back to the state before this write, so memory and disk stay equal and the operator is told it failed
    /// (DL-P004 amendment: an invoice reported as failed does not exist and its number is not used).
    pub fn write<T>(&self, f: impl FnOnce(&Transaction) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.lock()?;
        let inner = &mut *guard;
        let before = inner.conn.serialize(MAIN_DB)?.to_vec();
        let result = {
            let tx = inner.conn.transaction()?;
            let result = f(&tx)?; // an error drops `tx`, which rolls back
            tx.commit()?;
            result
        };
        if let Err(error) = write_snapshot(&inner.conn, &inner.key, &inner.db_path) {
            // the change is not on disk: undo it in memory as well
            inner.conn = connection_from(&before)?;
            return Err(error);
        }
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
        // The database file and the key file must always match. Write the restored database first;
        // only then replace the key, and if that fails put the previous database back (DL-P004 amendment).
        let target_key = new_key.unwrap_or(inner.key);
        write_snapshot(&conn, &target_key, &inner.db_path)?;
        if let Some(key) = new_key {
            if let Err(error) = keystore::save(&inner.key_path, &key) {
                let _ = write_snapshot(&inner.conn, &inner.key, &inner.db_path);
                return Err(error);
            }
            inner.key = key;
        }
        inner.conn = conn;
        Ok(())
    }
}

/// Decrypt a snapshot into a fresh in-memory connection.
fn load_snapshot(key: &DataKey, file: &[u8]) -> AppResult<Connection> {
    let plain = crypto::decrypt(key, file)?;
    connection_from(&plain)
}

/// A fresh in-memory connection holding a serialised (plain) database.
fn connection_from(plain: &[u8]) -> AppResult<Connection> {
    let mut conn = Connection::open_in_memory()?;
    conn.deserialize_read_exact(MAIN_DB, plain, plain.len(), false)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

/// Serialise, encrypt and atomically write the database; keep the previous file as `.prev`.
fn persist(inner: &Inner) -> AppResult<()> {
    write_snapshot(&inner.conn, &inner.key, &inner.db_path)
}

/// Serialise `conn` (its COMMITTED state — never call it inside an open transaction, DL-P029), encrypt, and replace the
/// file atomically: write a temp file, flush it to the disk (`sync_all`, so a power cut cannot leave
/// an empty file), keep the previous file as `.prev`, then rename over the database file.
fn write_snapshot(conn: &Connection, key: &DataKey, db_path: &Path) -> AppResult<()> {
    let plain = conn.serialize(MAIN_DB)?;
    let file = crypto::encrypt(key, &plain)?;
    let tmp = db_path.with_extension("tmp");
    {
        let mut out = fs::File::create(&tmp)?;
        out.write_all(&file)?;
        out.sync_all()?;
    }
    if db_path.exists() {
        fs::copy(db_path, db_path.with_extension("prev"))?;
    }
    fs::rename(&tmp, db_path)?;
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
    fn a_failed_disk_write_rolls_the_change_back_in_memory() {
        let dir = tempfile::tempdir().unwrap();
        let count = |store: &Store| -> i64 {
            store.read(|c| Ok(c.query_row("SELECT count(*) FROM families", [], |r| r.get(0))?)).unwrap()
        };
        let insert = |store: &Store, id: &str| {
            store.write(|tx| {
                tx.execute("INSERT INTO families(id, display_name, created_at) VALUES (?1, 'P', 'now')", [id])?;
                tx.execute(
                    "INSERT INTO invoice_sequences(entity, year, last_number) VALUES ('IMH', 2026, 1)
                     ON CONFLICT(entity, year) DO UPDATE SET last_number = last_number + 1",
                    [],
                )?;
                Ok(())
            })
        };
        let last_number = |store: &Store| -> i64 {
            store.read(|c| Ok(c.query_row("SELECT last_number FROM invoice_sequences", [], |r| r.get(0))?)).unwrap()
        };
        let store = Store::open(dir.path()).unwrap();
        insert(&store, "f1").unwrap();
        let before = fs::read(dir.path().join(DB_FILE)).unwrap();

        // A directory where the temp file must be written makes every disk write fail.
        let blocker = dir.path().join(DB_FILE).with_extension("tmp");
        fs::create_dir(&blocker).unwrap();
        assert!(matches!(insert(&store, "f2"), Err(AppError::Io(_))));
        assert_eq!(count(&store), 1, "the failed change is not left in memory");
        assert_eq!(last_number(&store), 1, "the invoice number of the failed write is not used");
        assert_eq!(fs::read(dir.path().join(DB_FILE)).unwrap(), before, "the file on disk is unchanged");

        fs::remove_dir(&blocker).unwrap();
        insert(&store, "f3").unwrap();
        assert_eq!(last_number(&store), 2, "numbering continues without a gap");
        drop(store);
        let reopened = Store::open(dir.path()).unwrap();
        assert_eq!(count(&reopened), 2, "the snapshot written before the commit holds the change");
        assert_eq!(last_number(&reopened), 2);
    }

    #[test]
    fn a_restore_that_cannot_save_the_new_key_leaves_a_database_that_still_opens() {
        let source = tempfile::tempdir().unwrap();
        let from = Store::open(source.path()).unwrap();
        from.write(|tx| {
            tx.execute("INSERT INTO families(id, display_name, created_at) VALUES ('s1','Iz kopije','now')", [])?;
            Ok(())
        })
        .unwrap();
        let backup = from.encrypted_snapshot().unwrap();
        let recovery = from.recovery_key().unwrap();

        let target = tempfile::tempdir().unwrap();
        let to = Store::open(target.path()).unwrap();
        to.write(|tx| {
            tx.execute("INSERT INTO families(id, display_name, created_at) VALUES ('t1','Postojeća','now')", [])?;
            Ok(())
        })
        .unwrap();
        // Saving the new key fails (its temp file path is a directory).
        fs::create_dir(target.path().join(KEY_FILE).with_extension("tmp")).unwrap();
        assert!(to.restore(&backup, Some(&recovery)).is_err());
        let names = |store: &Store| -> String {
            store.read(|c| Ok(c.query_row("SELECT group_concat(id) FROM families", [], |r| r.get(0))?)).unwrap()
        };
        assert_eq!(names(&to), "t1", "memory keeps the previous database");
        drop(to);
        let reopened = Store::open(target.path()).expect("database file and key file still match");
        assert_eq!(names(&reopened), "t1");
    }

    #[test]
    fn a_restore_that_cannot_write_the_database_keeps_the_old_key() {
        // Before 2026-11-21 the new key was saved first; a failed database write then left a key
        // file that no longer matched the database on disk, which could not be opened again.
        let source = tempfile::tempdir().unwrap();
        let from = Store::open(source.path()).unwrap();
        let backup = from.encrypted_snapshot().unwrap();
        let recovery = from.recovery_key().unwrap();

        let target = tempfile::tempdir().unwrap();
        let to = Store::open(target.path()).unwrap();
        to.write(|tx| {
            tx.execute("INSERT INTO families(id, display_name, created_at) VALUES ('t1','Postojeća','now')", [])?;
            Ok(())
        })
        .unwrap();
        let key_before = fs::read(target.path().join(KEY_FILE)).unwrap();
        fs::create_dir(target.path().join(DB_FILE).with_extension("tmp")).unwrap();
        assert!(to.restore(&backup, Some(&recovery)).is_err());
        assert_eq!(fs::read(target.path().join(KEY_FILE)).unwrap(), key_before, "the key file is untouched");
        drop(to);
        fs::remove_dir(target.path().join(DB_FILE).with_extension("tmp")).unwrap(); // the disk works again
        let reopened = Store::open(target.path()).expect("database file and key file still match");
        let count: i64 = reopened.read(|c| Ok(c.query_row("SELECT count(*) FROM families", [], |r| r.get(0))?)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn a_second_instance_is_refused_and_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let first = Store::open(dir.path()).unwrap();
        first
            .write(|tx| {
                tx.execute("INSERT INTO families(id, display_name, created_at) VALUES ('f1','Prva','now')", [])?;
                Ok(())
            })
            .unwrap();
        let before = fs::read(dir.path().join(DB_FILE)).unwrap();
        match Store::open(dir.path()) {
            Err(AppError::AlreadyRunning(message)) => assert_eq!(message, ALREADY_RUNNING_MESSAGE),
            Err(other) => panic!("expected AlreadyRunning, got {other}"),
            Ok(_) => panic!("a second instance must not open the database"),
        }
        assert_eq!(fs::read(dir.path().join(DB_FILE)).unwrap(), before, "the refused instance wrote nothing");
        // the wrapper keeps the kind of the error for the UI
        let refused = AppStore::new(Store::open(dir.path()));
        assert!(matches!(refused.get(), Err(AppError::AlreadyRunning(_))));
        drop(first);
        let reopened = Store::open(dir.path()).expect("the lock is released when the first instance ends");
        let count: i64 = reopened.read(|c| Ok(c.query_row("SELECT count(*) FROM families", [], |r| r.get(0))?)).unwrap();
        assert_eq!(count, 1);
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
/// The kind of the startup error is kept, so a second instance is reported as such (DL-P010).
pub struct AppStore(Result<Store, (bool, String)>);

impl AppStore {
    pub fn new(result: AppResult<Store>) -> Self {
        Self(result.map_err(|e| (matches!(e, AppError::AlreadyRunning(_)), e.to_string())))
    }

    pub fn get(&self) -> AppResult<&Store> {
        self.0.as_ref().map_err(|(already_running, reason)| {
            if *already_running {
                AppError::AlreadyRunning(reason.clone())
            } else {
                AppError::KeyStore(reason.clone())
            }
        })
    }
}

#[cfg(all(test, windows))]
mod last_write_survives {
    use super::*;

    fn count(store: &Store) -> i64 {
        store.read(|c| Ok(c.query_row("SELECT count(*) FROM settings WHERE key LIKE 'w%'", [], |r| r.get(0))?)).unwrap()
    }

    fn put(store: &Store, key: &str) {
        store
            .write(|tx| {
                tx.execute("INSERT INTO settings(key, value_json, updated_at) VALUES (?1, '1', 'now')", [key])?;
                Ok(())
            })
            .unwrap();
    }

    /// Director, 2026-11-27: an issued invoice (IMH-907/26) was gone after the app was restarted. The LAST write
    /// before closing must be on disk — also after the database was once loaded from disk (deserialized).
    #[test]
    fn the_last_write_before_closing_is_on_disk_after_reopening() {
        let dir = tempfile::tempdir().unwrap();
        {
            let store = Store::open(dir.path()).unwrap(); // first run: a fresh in-memory database
            put(&store, "w1");
        }
        {
            let store = Store::open(dir.path()).unwrap(); // loaded from disk
            assert_eq!(count(&store), 1);
            put(&store, "w2");
            put(&store, "w3"); // the last write before closing
        }
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(count(&store), 3, "the last write before closing was lost");
    }
}
