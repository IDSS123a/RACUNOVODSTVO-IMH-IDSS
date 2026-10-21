//! Application error type shared by all commands (Commander E-5).
//! Serialised to the frontend as `{ code, message }`; the frontend maps it to
//! `{ success: false, error, code }`. Messages never contain personal data.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),
    #[error("encryption error: {0}")]
    Crypto(String),
    #[error("key protection error: {0}")]
    KeyStore(String),
    #[error("invalid data: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("serialisation error: {0}")]
    Json(#[from] serde_json::Error),
}

impl AppError {
    /// Stable machine code for the frontend.
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Database(_) => "DATABASE",
            AppError::Io(_) => "IO",
            AppError::Crypto(_) => "CRYPTO",
            AppError::KeyStore(_) => "KEY_STORE",
            AppError::Validation(_) => "VALIDATION",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Conflict(_) => "CONFLICT",
            AppError::Json(_) => "JSON",
        }
    }
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    code: &'a str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ErrorPayload { code: self.code(), message: self.to_string() }.serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
