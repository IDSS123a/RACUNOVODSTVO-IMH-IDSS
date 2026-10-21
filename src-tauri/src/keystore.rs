//! Protection of the data key at rest with Windows DPAPI (DL-P004).
//!
//! The 32-byte data key is encrypted with `CryptProtectData`, which binds it to the
//! operator's Windows account. The protected blob is stored next to the database.
//! A one-time recovery key (base64 of the data key) lets the Director restore
//! backups on another machine or account.

use std::fs;
use std::path::Path;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

use crate::crypto::{DataKey, KEY_LEN};
use crate::error::{AppError, AppResult};

/// Load the data key from `key_path`, or create, protect and save a new one.
/// Returns the key and `true` when it was newly created (first run).
pub fn load_or_create(key_path: &Path) -> AppResult<(DataKey, bool)> {
    if key_path.exists() {
        let blob = fs::read(key_path)?;
        let raw = unprotect(&blob)?;
        let key: DataKey = raw
            .as_slice()
            .try_into()
            .map_err(|_| AppError::KeyStore("stored key has an unexpected length".into()))?;
        return Ok((key, false));
    }
    let key = crate::crypto::generate_key();
    save(key_path, &key)?;
    Ok((key, true))
}

/// Protect and store a key (atomic replace).
pub fn save(key_path: &Path, key: &DataKey) -> AppResult<()> {
    let blob = protect(key)?;
    let tmp = key_path.with_extension("tmp");
    fs::write(&tmp, blob)?;
    fs::rename(&tmp, key_path)?;
    Ok(())
}

/// Encode a key as a recovery string for the Director to print and keep.
pub fn to_recovery_string(key: &DataKey) -> String {
    BASE64.encode(key)
}

/// Decode a recovery string back into a key.
pub fn from_recovery_string(text: &str) -> AppResult<DataKey> {
    let cleaned: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    let raw = BASE64
        .decode(cleaned)
        .map_err(|_| AppError::Validation("ključ za oporavak nije ispravan".into()))?;
    raw.as_slice()
        .try_into()
        .map_err(|_| AppError::Validation(format!("ključ za oporavak mora imati {KEY_LEN} bajta")))
}

#[cfg(windows)]
fn protect(data: &[u8]) -> AppResult<Vec<u8>> {
    dpapi::protect(data)
}

#[cfg(windows)]
fn unprotect(data: &[u8]) -> AppResult<Vec<u8>> {
    dpapi::unprotect(data)
}

#[cfg(not(windows))]
fn protect(_data: &[u8]) -> AppResult<Vec<u8>> {
    Err(AppError::KeyStore("key protection is only implemented for Windows (DL-P001)".into()))
}

#[cfg(not(windows))]
fn unprotect(_data: &[u8]) -> AppResult<Vec<u8>> {
    Err(AppError::KeyStore("key protection is only implemented for Windows (DL-P001)".into()))
}

#[cfg(windows)]
mod dpapi {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    use crate::error::{AppError, AppResult};

    fn blob_in(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
    }

    /// Copy the output blob into a Vec and free the OS allocation.
    unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        // SAFETY: DPAPI returned a LocalAlloc'ed buffer of cbData bytes.
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) }.to_vec();
        // SAFETY: the pointer came from LocalAlloc inside DPAPI and is freed exactly once.
        unsafe {
            let _ = LocalFree(Some(HLOCAL(out.pbData.cast())));
        }
        bytes
    }

    pub fn protect(data: &[u8]) -> AppResult<Vec<u8>> {
        let input = blob_in(data);
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: input points to valid memory for the duration of the call; output is written by the OS.
        unsafe { CryptProtectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) }
            .map_err(|e| AppError::KeyStore(format!("CryptProtectData failed: {e}")))?;
        // SAFETY: output was filled by a successful CryptProtectData call.
        Ok(unsafe { take(output) })
    }

    pub fn unprotect(data: &[u8]) -> AppResult<Vec<u8>> {
        let input = blob_in(data);
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: as above.
        unsafe { CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) }
            .map_err(|_| {
                AppError::KeyStore(
                    "ključ baze ne može se otključati na ovom Windows nalogu — koristite ključ za oporavak".into(),
                )
            })?;
        // SAFETY: output was filled by a successful CryptUnprotectData call.
        Ok(unsafe { take(output) })
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn dpapi_round_trip_and_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("database.key");
        let (key, created) = load_or_create(&path).unwrap();
        assert!(created);
        let on_disk = std::fs::read(&path).unwrap();
        assert!(!on_disk.windows(KEY_LEN).any(|w| w == key), "raw key must not be stored in clear");
        let (again, created_again) = load_or_create(&path).unwrap();
        assert!(!created_again);
        assert_eq!(key, again);
    }

    #[test]
    fn recovery_string_round_trip() {
        let key = crate::crypto::generate_key();
        let text = to_recovery_string(&key);
        assert_eq!(from_recovery_string(&format!(" {text}\n")).unwrap(), key);
        assert!(from_recovery_string("not-base64!").is_err());
    }
}
