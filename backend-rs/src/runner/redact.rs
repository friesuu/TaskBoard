//! Hides anything that looks like a secret in what the runner sends (log lines, summaries, errors) before it's
//! saved (redact.ts in NestJS). The runner already does this on your laptop (runner/src/secrets.js); this is the
//! second lock, in case one slips through there.
//!
//! The patterns are NestJS's, written for the regex crate so they match exactly the same text:
//!   - `(?-u:\b)`: JavaScript's \b, where only A-Z, a-z, 0-9 and _ are word characters (the regex crate's own \b
//!     also counts letters like é)
//!   - [^{JS_SPACES}] for JavaScript's \S (validate.rs says why)
//!   - [A-Za-z] for JavaScript's /i on [a-z] (the regex crate's (?i) also takes K, the Kelvin sign, for k)

use std::sync::LazyLock;

use regex::Regex;

use crate::validate::JS_SPACES;

const HIDDEN: &str = "[hidden]";

/// Secrets with a shape of their own, replaced whole
static PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"sk-ant-[A-Za-z0-9_-]{20,}",                  // Anthropic API keys
        r"tbr_[A-Za-z0-9_-]{20,}",                     // task board runner tokens
        r"(?-u:\b)AKIA[0-9A-Z]{16}(?-u:\b)",           // AWS access keys
        r"(?-u:\b)gh[pousr]_[A-Za-z0-9]{36,}(?-u:\b)", // GitHub tokens
        // Private keys: from BEGIN to END, or to the end of the text when the END line was cut off.
        // (?s:.)*? : any characters, newlines too, as few as possible
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----(?s:.)*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)",
    ]
    .iter()
    .map(|pattern| Regex::new(pattern).unwrap())
    .collect()
});

/// .env-style lines whose name says they're secret: API_KEY=..., DB_PASSWORD: ..., JWT_SECRET=... The name and
/// the `=` stay; only the value is hidden.
static ASSIGNMENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?-u:\b)([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASS))([{JS_SPACES}]*[=:][{JS_SPACES}]*)[^{JS_SPACES}]+"
    ))
    .unwrap()
});

/// A password inside an address: postgres://user:password@host
static URL_PASSWORD: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?-u:\b)([A-Za-z][A-Za-z0-9+.-]*://[^{JS_SPACES}:@/]+:)[^{JS_SPACES}@/]+@"
    ))
    .unwrap()
});

pub fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for pattern in PATTERNS.iter() {
        // replace_all gives back a Cow: the same text when nothing matched (no copy), or a new one
        out = pattern.replace_all(&out, HIDDEN).into_owned();
    }
    // ${1}: what the first ( ) matched, as JavaScript's $1
    let out = ASSIGNMENT.replace_all(&out, "${1}${2}[hidden]");
    URL_PASSWORD.replace_all(&out, "${1}[hidden]@").into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The text the phase 7 capture sent, and what NestJS saved (target/phase7/nestjs.json)
    #[test]
    fn hides_secrets_like_nestjs() {
        let sent = "key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV, token tbr_ABCDEFGHIJKLMNOPQRSTUVWX, AKIAABCDEFGHIJKLMNOP, \
            ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij, API_KEY=abc123 DB_PASSWORD: hunter2 jwt_secret=x, \
            postgres://sam:pa55word@db.local/app, -----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY----- done";
        assert_eq!(
            redact(sent),
            "key [hidden], token [hidden], [hidden], [hidden], API_KEY=[hidden] DB_PASSWORD: [hidden] jwt_secret=x, \
            postgres://sam:[hidden]@db.local/app, [hidden] done"
        );
    }

    #[test]
    fn word_boundaries_like_javascript() {
        // é isn't a word character in JavaScript, so there's a boundary before AKIA
        assert_eq!(redact("éAKIAABCDEFGHIJKLMNOP"), "é[hidden]");
        assert_eq!(redact("xAKIAABCDEFGHIJKLMNOP"), "xAKIAABCDEFGHIJKLMNOP");
        assert_eq!(redact("éAPI_KEY=1"), "éAPI_KEY=[hidden]");
    }

    // Each answer below is what NestJS's redact() gave for the same text
    #[test]
    fn spaces_and_capitals_like_javascript() {
        // JavaScript's \s has U+FEFF and not U+0085: the value stops at the first, and goes on through the second
        assert_eq!(
            redact("DB_PASS\u{A0}=\u{A0}x\u{FEFF}y"),
            "DB_PASS\u{A0}=\u{A0}[hidden]\u{FEFF}y"
        );
        assert_eq!(redact("API_TOKEN=a\u{85}b c"), "API_TOKEN=[hidden] c");
        assert_eq!(
            redact("see HTTPS://me:pw@host and Ftp://a:b@c"),
            "see HTTPS://me:[hidden]@host and Ftp://a:[hidden]@c"
        );
        assert_eq!(redact("\u{17F}tp://a:b@c"), "\u{17F}tp://a:[hidden]@c"); // ſ isn't a letter of [A-Za-z]
    }

    #[test]
    fn a_private_key_cut_off() {
        assert_eq!(redact("start -----BEGIN PRIVATE KEY-----\nMIIabc"), "start [hidden]");
    }

    #[test]
    fn nothing_to_hide() {
        let text = "Edited src/search.js; ran pnpm test: 12 passed. https://example.com/a:b@c is fine?";
        assert_eq!(redact(text), text);
    }
}
