//! Canonical formats, checked again on save (defence in depth; the forms normalize, DL-P017).
//! Mirrors `src/lib/validation/formats.ts`: telephone, e-mail and IBAN must already be in their ONE canonical form.
//! An empty value is allowed where the field is optional.

use crate::error::{AppError, AppResult};

/// A subscriber number of one repeated digit (e.g. „+387 61 111 111“) is a placeholder (SPEC registration-validation A8).
fn is_placeholder_number(subscriber: &str) -> bool {
    let mut chars = subscriber.chars().filter(char::is_ascii_digit);
    match chars.next() {
        Some(first) => chars.all(|c| c == first),
        None => false,
    }
}

/// „+387 33 562 114“, „+387 60 345 1275“ or a foreign E.164 number „+4917612345678“.
pub fn is_canonical_phone(value: &str) -> bool {
    if let Some(national) = value.strip_prefix("+387 ") {
        let parts: Vec<&str> = national.split(' ').collect();
        return parts.len() == 3
            && !is_placeholder_number(&format!("{}{}", parts[1], parts[2]))
            && parts[0].len() == 2
            && parts[1].len() == 3
            && (parts[2].len() == 3 || parts[2].len() == 4)
            && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()))
            && matches!(parts[0].as_bytes()[0], b'3'..=b'6');
    }
    let Some(digits) = value.strip_prefix('+') else { return false };
    !digits.starts_with("387")
        && (8..=15).contains(&digits.len())
        && digits.chars().all(|c| c.is_ascii_digit())
        && !is_placeholder_number(digits.get(3..).unwrap_or(""))
}

/// A person's name as saved: not empty, at most 80 characters, letters of any alphabet with their accents, space,
/// hyphen, apostrophe and dot — no digits or other symbols (SPEC registration-validation A5; the forms normalize).
pub fn is_plausible_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.chars().count() <= 80
        && trimmed.chars().next().is_some_and(char::is_alphabetic)
        && trimmed.chars().all(|c| c.is_alphabetic() || matches!(c, ' ' | '-' | '\'' | '.') || is_combining_mark(c))
}

/// Unicode combining marks (accents typed as a separate character).
fn is_combining_mark(c: char) -> bool {
    matches!(c as u32, 0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F)
}

pub fn check_name(value: &str, what: &str) -> AppResult<()> {
    if is_plausible_name(value) {
        Ok(())
    } else {
        Err(AppError::Validation(format!("{what}: dozvoljena su samo slova (i razmak, crtica, apostrof), bez brojeva i simbola")))
    }
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
        // SPEC registration-validation A8: one repeated digit is a placeholder; a sequence is a real number
        for placeholder in ["+387 61 111 111", "+387 33 000 000", "+49111111111111"] {
            assert!(!is_canonical_phone(placeholder), "{placeholder}");
        }
        assert!(is_canonical_phone("+387 61 123 456"));
    }

    /// SPEC registration-validation A5: names of every alphabet; no digits or symbols.
    #[test]
    fn names() {
        for ok in ["María", "Łukasz", "Şahin", "Müller", "Van der Berg", "O'Neil", "Đurđa Čolić-Šećić", "Jean-Pierre", "e\u{301}va"] {
            assert!(is_plausible_name(ok), "{ok}");
        }
        let too_long = "A".repeat(81);
        for bad in ["", "   ", "Amir123", "Beg!ović", "-Ana", "Ana <b>", too_long.as_str()] {
            assert!(!is_plausible_name(bad), "{bad}");
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
