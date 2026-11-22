//! Canonical formats, checked again on save (defence in depth; the forms normalize, DL-P017).
//! Mirrors `src/lib/validation/formats.ts`: telephone, e-mail and IBAN must already be in their ONE canonical form.
//! An empty value is allowed where the field is optional.

use crate::error::{AppError, AppResult};

/// „+387 33 562 114“, „+387 60 345 1275“ or a foreign E.164 number „+4917612345678“.
pub fn is_canonical_phone(value: &str) -> bool {
    if let Some(national) = value.strip_prefix("+387 ") {
        let parts: Vec<&str> = national.split(' ').collect();
        return parts.len() == 3
            && parts[0].len() == 2
            && parts[1].len() == 3
            && (parts[2].len() == 3 || parts[2].len() == 4)
            && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()))
            && matches!(parts[0].as_bytes()[0], b'3'..=b'6');
    }
    let Some(digits) = value.strip_prefix('+') else { return false };
    !digits.starts_with("387") && (8..=15).contains(&digits.len()) && digits.chars().all(|c| c.is_ascii_digit())
}

/// Lower case, one „@“, a dot in the domain, no spaces.
pub fn is_canonical_email(value: &str) -> bool {
    let Some((local, domain)) = value.split_once('@') else { return false };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.contains('@')
        && value == value.to_lowercase()
        && !value.chars().any(char::is_whitespace)
}

/// „BA39 1990 4900 5848 7943“: grouped by four, with valid check digits (ISO 13616).
pub fn is_canonical_iban(value: &str) -> bool {
    let compact: String = value.chars().filter(|c| *c != ' ').collect();
    if compact.len() != 20 || !compact.starts_with("BA") || !compact[2..].chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let grouped: String = compact.as_bytes().chunks(4).map(|c| std::str::from_utf8(c).unwrap_or("")).collect::<Vec<_>>().join(" ");
    if grouped != value {
        return false;
    }
    let rearranged = format!("{}{}", &compact[4..], "1110"); // „BA“ = 11 10
    let rearranged = format!("{rearranged}{}", &compact[2..4]);
    rearranged.bytes().fold(0u32, |r, d| (r * 10 + u32::from(d - b'0')) % 97) == 1
}

fn check(ok: bool, what: &str, format: &str) -> AppResult<()> {
    if ok { Ok(()) } else { Err(AppError::Validation(format!("{what} nije u dozvoljenom formatu ({format})"))) }
}

pub fn check_phone(value: &str, what: &str) -> AppResult<()> {
    check(value.is_empty() || is_canonical_phone(value), what, "+387 33 562 114")
}

pub fn check_email(value: &str, what: &str) -> AppResult<()> {
    check(value.is_empty() || is_canonical_email(value), what, "ime@domena.ba")
}

pub fn check_iban(value: &str, what: &str) -> AppResult<()> {
    check(value.is_empty() || is_canonical_iban(value), what, "BA39 1990 4900 5848 7943")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phones() {
        for ok in ["+387 33 562 114", "+387 60 345 1275", "+4917612345678"] {
            assert!(is_canonical_phone(ok), "{ok}");
        }
        for bad in ["033562114", "+387/33 562-114", "+387 33 5621 14", "+387 99 562 114", "+38733562114", "+49 176", ""] {
            assert!(!is_canonical_phone(bad), "{bad}");
        }
    }

    #[test]
    fn emails() {
        assert!(is_canonical_email("info@idss.ba"));
        for bad in ["Info@idss.ba", "info@idss", "info idss@x.ba", "@x.ba", "a@b@c.ba"] {
            assert!(!is_canonical_email(bad), "{bad}");
        }
    }

    #[test]
    fn ibans() {
        assert!(is_canonical_iban("BA39 1990 4900 5848 7943"));
        assert!(is_canonical_iban("BA39 1994 9900 2180 9884"));
        for bad in ["BA391990490058487943", "BA38 1990 4900 5848 7943", "ba39 1990 4900 5848 7943", "DE89 3704 0044 0532 0130 00"] {
            assert!(!is_canonical_iban(bad), "{bad}");
        }
        assert!(check_iban("", "IBAN").is_ok());
    }
}
