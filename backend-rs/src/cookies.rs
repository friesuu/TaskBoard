//! The login cookie's Set-Cookie header, written exactly the way NestJS writes it (Express's res.cookie and
//! res.clearCookie in ../backend/src/auth/auth-cookies.ts). It has to be the same cookie with the same
//! settings, or "log out" wouldn't remove a cookie made by "log in" (browsers match them by name and Path).

use std::time::SystemTime;

/// The cookie's name, the same in NestJS
pub const AUTH_COOKIE: &str = "taskToken";

/// How long a login lasts: one day, the same as the token inside it (TOKEN_LIFETIME_SECONDS in auth.rs)
pub const COOKIE_LIFETIME_SECONDS: u64 = 24 * 60 * 60;

// ===================================== YOUR PART (phase 2) =====================================
// Two function bodies to write. The tests at the bottom say exactly what each must give back, and they
// fail until you're done: `cargo test cookies`. The steps are in ../README.md.

/// Logging in (and changing the password): puts the token in the browser, for one day.
///
/// The header, with `now` = 28 Oct 2026 08:15:40 GMT and secure = false:
///   taskToken=<token>; Max-Age=86400; Path=/; Expires=Thu, 29 Oct 2026 08:15:40 GMT; HttpOnly; SameSite=Lax
/// With secure = true (the real server, NODE_ENV=production), "; Secure" comes right before "; SameSite=Lax":
/// the browser then only sends it over https.
///
/// Hints:
/// - `format!("...{token}...")` puts values into text.
/// - Expires is `now` plus a day: `now + std::time::Duration::from_secs(COOKIE_LIFETIME_SECONDS)`.
/// - `httpdate::fmt_http_date(time)` writes a time the way cookies need it ("Thu, 29 Oct 2026 08:15:40 GMT").
/// - `if secure { "; Secure" } else { "" }` is an expression: it gives back one of the two texts.
pub fn login_cookie(token: &str, secure: bool, now: SystemTime) -> String {
    let expires_at = now + std::time::Duration::from_secs(COOKIE_LIFETIME_SECONDS);
    let expires_text = httpdate::fmt_http_date(expires_at);
    let secure_part = if secure { "; Secure" } else { "" };

    format!(
        "{AUTH_COOKIE}={token}; Max-Age={COOKIE_LIFETIME_SECONDS}; Path=/; Expires={expires_text}; HttpOnly{secure_part}; SameSite=Lax"
    )
}

/// Logging out (and deleting the account): tells the browser to delete the cookie, by sending it empty and
/// already expired (1 Jan 1970). JavaScript can't delete it itself: the cookie is HttpOnly.
///
///   taskToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax
/// and with secure = true, "; Secure" before "; SameSite=Lax" again.
pub fn clear_cookie(secure: bool) -> String {
    let secure_part = if secure { "; Secure" } else { "" };

    format!("{AUTH_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly{secure_part}; SameSite=Lax")
}
// ================================================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, UNIX_EPOCH};

    // The expected headers are what NestJS (Express) wrote for the same token and time, captured on 2026-10-28
    const NOW: u64 = 1_793_175_340; // 28 Oct 2026 08:15:40 GMT, in seconds since 1 Jan 1970

    fn now() -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(NOW)
    }

    #[test]
    fn logging_in() {
        assert_eq!(
            login_cookie("abc.def.ghi", false, now()),
            "taskToken=abc.def.ghi; Max-Age=86400; Path=/; Expires=Thu, 29 Oct 2026 08:15:40 GMT; HttpOnly; SameSite=Lax"
        );
    }

    #[test]
    fn logging_in_on_the_real_server() {
        assert_eq!(
            login_cookie("abc.def.ghi", true, now()),
            "taskToken=abc.def.ghi; Max-Age=86400; Path=/; Expires=Thu, 29 Oct 2026 08:15:40 GMT; HttpOnly; Secure; SameSite=Lax"
        );
    }

    #[test]
    fn logging_out() {
        assert_eq!(
            clear_cookie(false),
            "taskToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"
        );
    }

    #[test]
    fn logging_out_on_the_real_server() {
        assert_eq!(
            clear_cookie(true),
            "taskToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax"
        );
    }
}
