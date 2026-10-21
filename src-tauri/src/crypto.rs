//! Authenticated encryption of database snapshots (DL-P004, Zakon čl. 53h).
//!
//! File format: MAGIC (8 bytes) | NONCE (12 bytes) | AES-256-GCM ciphertext+tag.
//! A fresh random nonce is used for every write. Tampering or a wrong key makes
//! decryption fail loudly — never silently (E-5).

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};

use crate::error::{AppError, AppResult};

/// File signature, versioned so the format can evolve.
pub const MAGIC: &[u8; 8] = b"FKIDB\x00\x01\x00";
pub const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

/// A 256-bit data-encryption key.
pub type DataKey = [u8; KEY_LEN];

/// Generate a new random data key from the OS CSPRNG.
pub fn generate_key() -> DataKey {
    rand::random::<DataKey>()
}

/// Encrypt plaintext with the key into the snapshot file format.
pub fn encrypt(key: &DataKey, plaintext: &[u8]) -> AppResult<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Crypto(e.to_string()))?;
    let nonce_bytes = rand::random::<[u8; NONCE_LEN]>();
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|_| AppError::Crypto("encryption failed".into()))?;
    let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a snapshot. Fails if the file is not ours, truncated, tampered with, or the key is wrong.
pub fn decrypt(key: &DataKey, file: &[u8]) -> AppResult<Vec<u8>> {
    if file.len() < MAGIC.len() + NONCE_LEN || &file[..MAGIC.len()] != MAGIC {
        return Err(AppError::Crypto("not an encrypted database file of this application".into()));
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Crypto(e.to_string()))?;
    let nonce_bytes: [u8; NONCE_LEN] = file[MAGIC.len()..MAGIC.len() + NONCE_LEN]
        .try_into()
        .map_err(|_| AppError::Crypto("corrupt nonce".into()))?;
    let nonce = Nonce::from(nonce_bytes);
    cipher
        .decrypt(&nonce, &file[MAGIC.len() + NONCE_LEN..])
        .map_err(|_| AppError::Crypto("wrong key or damaged file".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let key = generate_key();
        let data = b"SQLite format 3\0 some bytes";
        let file = encrypt(&key, data).unwrap();
        assert_eq!(&file[..8], MAGIC);
        assert_eq!(decrypt(&key, &file).unwrap(), data);
    }

    #[test]
    fn ciphertext_hides_sqlite_header() {
        let key = generate_key();
        let file = encrypt(&key, b"SQLite format 3\0").unwrap();
        assert!(!file.windows(15).any(|w| w == b"SQLite format 3"));
    }

    #[test]
    fn wrong_key_and_tampering_fail() {
        let key = generate_key();
        let mut file = encrypt(&key, b"secret").unwrap();
        assert!(decrypt(&generate_key(), &file).is_err());
        let last = file.len() - 1;
        file[last] ^= 0xFF;
        assert!(decrypt(&key, &file).is_err());
        assert!(decrypt(&key, b"short").is_err());
    }

    #[test]
    fn nonces_differ_between_writes() {
        let key = generate_key();
        let a = encrypt(&key, b"same").unwrap();
        let b = encrypt(&key, b"same").unwrap();
        assert_ne!(a, b);
    }
}
