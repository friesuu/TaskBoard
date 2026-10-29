//! Input rules, with the messages NestJS's class-validator gives, because the frontend shows them. Each rule
//! gives back None when it's kept, or its message when it's broken; `check` sends every broken rule's
//! message at once, like NestJS's ValidationPipe:
//!
//! ```text
//! validate::check([
//!     validate::email("email", &email),
//!     validate::not_empty("password", &password),
//! ])?;
//! ```
//!
//! The order of the messages is NestJS's: fields in the order the input type lists them, and within one field,
//! the rules in the opposite order of the decorators above it (class-validator adds them bottom up).
//! The tables in the tests are what NestJS (class-validator and Node) answered for the same text.

use std::sync::LazyLock;

use regex::Regex;

use crate::errors::invalid_input;
use crate::iso8601;

/// Ok when no rule is broken; otherwise the "Bad Request Exception" error with every broken rule's message
pub fn check<const N: usize>(rules: [Option<String>; N]) -> async_graphql::Result<()> {
    let messages: Vec<String> = rules.into_iter().flatten().collect();
    if messages.is_empty() {
        Ok(())
    } else {
        Err(invalid_input(messages))
    }
}

/// @IsNotEmpty: not "" (spaces are fine)
pub fn not_empty(field: &str, text: &str) -> Option<String> {
    text.is_empty().then(|| format!("{field} should not be empty"))
}

/// @MinLength
pub fn at_least(field: &str, text: &str, min: usize) -> Option<String> {
    (length(text) < min).then(|| format!("{field} must be longer than or equal to {min} characters"))
}

/// @MaxLength
pub fn at_most(field: &str, text: &str, max: usize) -> Option<String> {
    (length(text) > max).then(|| format!("{field} must be shorter than or equal to {max} characters"))
}

/// @IsEmail
pub fn email(field: &str, text: &str) -> Option<String> {
    (!is_email(text)).then(|| format!("{field} must be an email"))
}

/// @IsTimeZone
pub fn time_zone(field: &str, text: &str) -> Option<String> {
    (!is_time_zone(text)).then(|| format!("{field} must be a valid IANA time-zone"))
}

/// The display name's own rule (@Matches in display-name.dto.ts): no control characters (Cc) and no
/// invisible formatting characters (Cf), which could hide a name or make one look like another
pub fn no_hidden_characters(text: &str) -> Option<String> {
    static VISIBLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[^\p{Cc}\p{Cf}]*$").unwrap());
    (!VISIBLE.is_match(text)).then(|| "The name can't contain invisible or control characters".to_string())
}

/// The board project's own rule (@Matches in board-project.dto.ts): a project name from the runner, lowercase
/// letters and digits with single dashes between them ("notes-app"), or nothing at all (no project)
pub fn project_name(text: &str) -> Option<String> {
    static PROJECT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([a-z0-9]+(-[a-z0-9]+)*)?$").unwrap());
    (!PROJECT.is_match(text))
        .then(|| r#"Use a project name from the runner, e.g. "notes-app" (letters, digits and dashes)"#.to_string())
}

/// A board's or a label's name (board-name.dto.ts, label.dto.ts): see `trimmed`
pub fn name(text: &str, max: usize) -> async_graphql::Result<&str> {
    trimmed("name", text, max)
}

/// The usual rule for a piece of text (a name, a checklist item, a comment): trimmed, then @IsString
/// @IsNotEmpty @MaxLength(max), checked bottom up. Gives back the trimmed text, which is the one that's saved.
pub fn trimmed<'a>(field: &str, text: &'a str, max: usize) -> async_graphql::Result<&'a str> {
    let text = js_trim(text);
    check([at_most(field, text, max), not_empty(field, text)])?;
    Ok(text)
}

/// A text's length the way class-validator counts it: one per character (an emoji is one, although
/// JavaScript's own .length says two), and the invisible "show this as an emoji" marks (U+FE0E, U+FE0F) not at all
pub fn length(text: &str) -> usize {
    text.chars().filter(|c| !matches!(c, '\u{FE0E}' | '\u{FE0F}')).count()
}

/// JavaScript's .trim(). Rust's .trim() takes off a slightly different set of characters (it keeps
/// U+FEFF and removes U+0085), and NestJS trims with JavaScript's.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

/// A space the way JavaScript sees one: what .trim() takes off, and what \s matches in a pattern
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// @IsDateString({ strict: true }): validator.js's ISO 8601 check (iso8601.rs). "2026-10" passes it, so the due
/// date has date_format too.
pub fn iso_date(field: &str, text: &str) -> Option<String> {
    (!iso8601::is_valid(text)).then(|| format!("{field} must be a valid ISO 8601 date string"))
}

/// The due date's own rule (@Matches in create-task.dto.ts): exactly YYYY-MM-DD
pub fn date_format(text: &str) -> Option<String> {
    static DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$").unwrap());
    (!DATE.is_match(text)).then(|| "dueDate must be in YYYY-MM-DD format".to_string())
}

/// @ArrayMaxSize
pub fn at_most_items<T>(field: &str, list: &[T], max: usize) -> Option<String> {
    (list.len() > max).then(|| format!("{field} must contain no more than {max} elements"))
}

/// @Min
pub fn not_below(field: &str, number: i32, min: i32) -> Option<String> {
    (number < min).then(|| format!("{field} must not be less than {min}"))
}

/// A real time zone, by the same rule as Node's Intl (which class-validator asks): an IANA name in any mix of
/// capitals ("Europe/London", "europe/london", "US/Eastern", "UTC"), or an offset from UTC ("+05:00", "-0330", "+05")
pub fn is_time_zone(text: &str) -> bool {
    static OFFSET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[+-]([01][0-9]|2[0-3])(:?[0-5][0-9])?$").unwrap());
    // "Factory" is in the time zone database, but Intl refuses it (it means "no time zone set")
    OFFSET.is_match(text)
        || (chrono_tz::Tz::from_str_insensitive(text).is_ok() && !text.eq_ignore_ascii_case("factory"))
}

/// An email address, by the same rule as class-validator's @IsEmail (validator.js isEmail, default options)
pub fn is_email(text: &str) -> bool {
    // Letters (any language), digits, and !#$%&'*+-/=?^_`{|}~, between dots
    static LOCAL_PART: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^[a-z0-9!#$%&'*+\-/=?^_`{|}~\x{A1}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}]+$").unwrap()
    });
    // "anything in quotes"@example.com, with \ before a quote or backslash
    static QUOTED: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(concat!(
            r"(?i)^([\s\x01-\x08\x0b\x0c\x0e-\x1f\x7f\x21\x23-\x5b\x5d-\x7e\x{A1}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}]",
            r"|(\\[\x01-\x09\x0b\x0c\x0d-\x7f\x{A1}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}]))*$"
        ))
        .unwrap()
    });

    // At most 254 characters, counted like JavaScript's .length (an emoji counts as 2)
    if text.encode_utf16().count() > 254 {
        return false;
    }
    // The last @ splits it: "name@example.com"
    let Some((user, domain)) = text.rsplit_once('@') else {
        return false;
    };
    // In bytes: at most 64 before the @, 254 after it
    if user.len() > 64 || domain.len() > 254 || !is_domain_name(domain) {
        return false;
    }
    if let Some(inside) = user.strip_prefix('"') {
        // validator.js takes off the first and last character, whatever the last one is
        let inside: String = inside.chars().take(inside.chars().count().saturating_sub(1)).collect();
        return QUOTED.is_match(&inside);
    }
    user.split('.').all(|part| LOCAL_PART.is_match(part))
}

/// A full domain name with a real top-level domain (validator.js isFQDN, as isEmail calls it):
/// "example.com" yes; "localhost", "example.123", "-bad.com", "under_score.com" no
fn is_domain_name(domain: &str) -> bool {
    static TOP_LEVEL: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^([a-z\x{A1}-\x{A8}\x{AA}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}]{2,}|xn[a-z0-9-]{2,})$")
            .unwrap()
    });
    // JavaScript checks text as UTF-16, where an emoji is two "characters" in ¡-￿: so any character
    // from U+00A1 up, emoji included, is allowed here
    static PART: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^[a-z_\x{A1}-\x{10FFFF}0-9-]+$").unwrap());
    static FULL_WIDTH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\x{FF01}-\x{FF5E}]").unwrap());

    let parts: Vec<&str> = domain.split('.').collect();
    let Some(top_level) = parts.last() else {
        return false;
    };
    if parts.len() < 2 || !TOP_LEVEL.is_match(top_level) || top_level.chars().any(char::is_whitespace) {
        return false;
    }
    parts.iter().all(|part| {
        part.encode_utf16().count() <= 63
            && PART.is_match(part)
            && !FULL_WIDTH.is_match(part)
            && !part.starts_with('-')
            && !part.ends_with('-')
            && !part.contains('_')
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_addresses_like_class_validator() {
        let x = |n: usize| "x".repeat(n);
        // (address, what class-validator said)
        let table: Vec<(String, bool)> = vec![
            ("a@b.co".into(), true),
            ("a@b.c".into(), false),
            ("a@b".into(), false),
            ("a.b@c.de".into(), true),
            ("a..b@c.de".into(), false),
            (".a@c.de".into(), false),
            ("a.@c.de".into(), false),
            ("a+tag@c.de".into(), true),
            ("a_b@c-d.de".into(), true),
            ("a@-c.de".into(), false),
            ("a@c-.de".into(), false),
            ("a@c_d.de".into(), false),
            ("a@c..de".into(), false),
            ("a@c.de.".into(), false),
            ("a@c.123".into(), false),
            ("a@c.d1".into(), false),
            ("a@xn--80ak6aa92e.com".into(), true),
            ("a@c.xn--p1ai".into(), true),
            (r#""quoted local"@c.de"#.into(), true),
            (r#""a\"b"@c.de"#.into(), true),
            ("a b@c.de".into(), false),
            ("a@c d.de".into(), false),
            ("ü@c.de".into(), true),
            ("a@ü.de".into(), true),
            ("a@c.üü".into(), true),
            ("😀@c.de".into(), false),
            ("a@😀.de".into(), true),
            ("a@c.😀😀".into(), false),
            ("a@ｃ.de".into(), false),
            ("a@b@c.de".into(), false),
            ("@c.de".into(), false),
            ("a@".into(), false),
            (format!("{}@c.de", x(64)), true),
            (format!("{}@c.de", x(65)), false),
            (format!("a@{}.de", x(63)), true),
            (format!("a@{}.de", x(64)), false),
            (format!("a@{}de", format!("{}.", x(60)).repeat(4)), true),
            (format!("a@{}de", format!("{}.", x(60)).repeat(5)), false),
            ("test@[127.0.0.1]".into(), false),
            ("a@127.0.0.1".into(), false),
            ("A@C.DE".into(), true),
            ("a@c.DE".into(), true),
            ("a!#$%&'*+-/=?^_`{|}~@c.de".into(), true),
            ("a@c.d-e".into(), false),
            ("a@c.-de".into(), false),
        ];
        for (address, expected) in table {
            assert_eq!(is_email(&address), expected, "{address}");
        }
    }

    #[test]
    fn time_zones_like_node() {
        // (time zone, what Node's Intl said)
        let table = [
            ("Europe/London", true),
            ("europe/london", true),
            ("EUROPE/LONDON", true),
            ("Asia/Calcutta", true),
            ("US/Eastern", true),
            ("EST", true),
            ("PST8PDT", true),
            ("Etc/GMT+5", true),
            ("etc/gmt+5", true),
            ("GMT", true),
            ("UTC", true),
            ("utc", true),
            ("Etc/UTC", true),
            ("Z", false),
            ("+05:00", true),
            ("+0500", true),
            ("+05", true),
            ("-12:00", true),
            ("+14:00", true),
            ("+24:00", false),
            ("+05:60", false),
            ("+5:00", false),
            ("05:00", false),
            ("+05:00:00", false),
            ("Europe/London ", false),
            (" Europe/London", false),
            ("", false),
            ("Mars/Olympus_Mons", false),
            ("America/Argentina/Buenos_Aires", true),
            ("Antarctica/Troll", true),
            ("Factory", false),
            ("localtime", false),
            ("EST5EDT", true),
            ("Navajo", true),
            ("GB", true),
            ("Zulu", true),
            ("UCT", true),
            ("Universal", true),
            ("Asia/Kolkata", true),
            ("America/Ciudad_Juarez", true),
            ("Europe/Kyiv", true),
            ("Europe/Kiev", true),
        ];
        for (zone, expected) in table {
            assert_eq!(is_time_zone(zone), expected, "{zone:?}");
        }
    }

    #[test]
    fn lengths_like_class_validator() {
        assert_eq!(length(&"x".repeat(50)), 50);
        assert_eq!(length(&"😀".repeat(26)), 26); // JavaScript's .length: 52
        assert_eq!(length(&"\u{270C}\u{FE0F}".repeat(50)), 50); // ✌️: the emoji mark doesn't count
        assert_eq!(length(&"e\u{301}".repeat(25)), 50); // e + a separate accent: two
        assert!(at_most("displayName", &"x".repeat(50), 50).is_none());
        assert_eq!(
            at_most("displayName", &"x".repeat(51), 50).as_deref(),
            Some("displayName must be shorter than or equal to 50 characters")
        );
        assert_eq!(
            at_least("newPassword", "short", 8).as_deref(),
            Some("newPassword must be longer than or equal to 8 characters")
        );
        assert_eq!(
            not_empty("password", "").as_deref(),
            Some("password should not be empty")
        );
        assert!(not_empty("password", " ").is_none());
    }

    #[test]
    fn trimming_like_javascript() {
        // JavaScript's .trim() of this kept only "x\u{85}\u{180E}\u{200B}"
        assert_eq!(
            js_trim("\u{A0}\u{FEFF}\u{2028}x\u{85}\u{180E}\u{200B}"),
            "x\u{85}\u{180E}\u{200B}"
        );
        assert_eq!(js_trim("  Sam Lee  "), "Sam Lee");
    }

    #[test]
    fn project_names() {
        for good in ["notes-app", "app2", "a-b-c", ""] {
            assert!(project_name(good).is_none(), "{good:?}");
        }
        for bad in ["notes app", "-x", "x-", "a--b", "Notes", "ab\nc", "notes_app", "ü"] {
            assert!(project_name(bad).is_some(), "{bad:?}");
        }
    }

    #[test]
    fn hidden_characters() {
        assert!(no_hidden_characters("Sam Lee").is_none());
        assert!(no_hidden_characters("Zoë 😀").is_none());
        assert!(no_hidden_characters("Sam\u{200B}Lee").is_some()); // zero-width space (Cf)
        assert!(no_hidden_characters("Sam\u{7}Lee").is_some()); // bell (Cc)
        assert!(no_hidden_characters("\u{202E}eeL maS").is_some()); // right-to-left override (Cf)
    }
}
