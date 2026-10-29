//! Who's logged in: the login cookie, a JWT in the httpOnly cookie "taskToken", saying who you are (`sub`, your
//! user id) and which password "generation" it was made for (`ver`, your token version). In NestJS that's
//! jwt.strategy.ts, gql-auth.guard.ts (current_user here), current-user.decorator.ts and auth-cookies.ts.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use async_graphql::Context;
use axum::http::HeaderMap;
use axum::http::header::{COOKIE, SET_COOKIE};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::config::Config;
use crate::cookies::{self, AUTH_COOKIE};
use crate::errors::{internal, unauthorized};
use crate::users::{self, User};

/// How long a login token lasts: one day (JwtModule's expiresIn: '1d' in NestJS)
const TOKEN_LIFETIME_SECONDS: u64 = 24 * 60 * 60;

/// One request's login cookie (None: it didn't have one), handed to the GraphQL resolvers with the request.
/// A struct around one value (a "newtype"), so it can't be mixed up with any other `Option<String>`.
pub struct LoginCookie(pub Option<String>);

/// The keys that sign tokens and check them, both made once from JWT_SECRET and kept in the schema
pub struct JwtKeys {
    signing: EncodingKey,
    checking: DecodingKey,
}

impl JwtKeys {
    pub fn new(secret: &str) -> JwtKeys {
        JwtKeys {
            signing: EncodingKey::from_secret(secret.as_bytes()),
            checking: DecodingKey::from_secret(secret.as_bytes()),
        }
    }
}

/// What's inside the token. serde turns it into the token's JSON and back. `ver` is an Option because tokens
/// from before token versions existed don't have one (those never match, like in NestJS).
#[derive(Serialize, Deserialize)]
struct Claims {
    sub: i32,
    ver: Option<i32>,
    iat: u64, // issued at, in seconds since 1 Jan 1970
    exp: u64, // expires at
}

/// The login cookie from a request's Cookie headers, e.g. "theme=dark; taskToken=eyJ..." gives "eyJ...".
/// A request can have several Cookie headers; the first taskToken wins, as in NestJS (cookie-parser).
pub fn login_cookie(headers: &HeaderMap) -> LoginCookie {
    let token = headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|header| header.to_str().ok()) // a header that isn't plain text is skipped
        .flat_map(|header| header.split(';'))
        .find_map(|pair| {
            // "name=value"; something without "=" (e.g. "HttpOnly") makes split_once give None: skipped
            let (name, value) = pair.trim().split_once('=')?;
            (name == AUTH_COOKIE && !value.is_empty()).then(|| value.to_string())
        });
    LoginCookie(token)
}

/// The logged-in user. Otherwise NestJS's "Unauthorized": no cookie, a forged or expired token, or one made
/// before a password change (the user's token version has gone up since).
pub async fn current_user(ctx: &Context<'_>) -> async_graphql::Result<User> {
    // `let ... else`: take the value out, or stop here if there isn't one
    let Some(token) = ctx.data_opt::<LoginCookie>().and_then(|cookie| cookie.0.as_deref()) else {
        return Err(unauthorized());
    };
    let keys = ctx.data::<JwtKeys>()?;
    // HS256: how NestJS's JwtModule signs. The expiry date (exp, a day after logging in) is checked too.
    let Ok(token) = decode::<Claims>(token, &keys.checking, &Validation::new(Algorithm::HS256)) else {
        return Err(unauthorized());
    };

    let db = ctx.data::<PgPool>()?;
    match users::find(db, token.claims.sub).await.map_err(internal)? {
        // `if` in a match arm: this arm only counts when the token versions match too
        Some(user) if Some(user.token_version) == token.claims.ver => Ok(user),
        _ => Err(unauthorized()),
    }
}

/// A new login token for this user, and the cookie that puts it in the browser
pub fn set_login_cookie(ctx: &Context<'_>, user: &User) -> async_graphql::Result<()> {
    let now = SystemTime::now();
    let issued = now.duration_since(UNIX_EPOCH).map_err(internal)?.as_secs();
    let claims = Claims {
        sub: user.id,
        ver: Some(user.token_version),
        iat: issued,
        exp: issued + TOKEN_LIFETIME_SECONDS,
    };
    let token = encode(&Header::new(Algorithm::HS256), &claims, &ctx.data::<JwtKeys>()?.signing).map_err(internal)?;

    let secure = ctx.data::<Arc<Config>>()?.secure_cookies;
    ctx.append_http_header(SET_COOKIE, cookies::login_cookie(&token, secure, now));
    Ok(())
}

/// Tells the browser to delete the login cookie (logging out, deleting the account)
pub fn clear_login_cookie(ctx: &Context<'_>) -> async_graphql::Result<()> {
    let secure = ctx.data::<Arc<Config>>()?.secure_cookies;
    ctx.append_http_header(SET_COOKIE, cookies::clear_cookie(secure));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie(headers: &[&str]) -> Option<String> {
        let mut map = HeaderMap::new();
        for header in headers {
            map.append(COOKIE, header.parse().unwrap());
        }
        login_cookie(&map).0
    }

    #[test]
    fn finds_the_login_cookie() {
        assert_eq!(cookie(&["taskToken=abc.def"]), Some("abc.def".to_string()));
        assert_eq!(cookie(&["theme=dark; taskToken=abc; other=1"]), Some("abc".to_string()));
        // What the e2e tests send: the whole Set-Cookie line from logging in
        assert_eq!(
            cookie(&["taskToken=abc; Path=/; HttpOnly; SameSite=Lax"]),
            Some("abc".to_string())
        );
        // Two Cookie headers: the first login cookie
        assert_eq!(
            cookie(&["theme=dark", "taskToken=first", "taskToken=second"]),
            Some("first".to_string())
        );
    }

    #[test]
    fn no_login_cookie() {
        assert_eq!(cookie(&[]), None);
        assert_eq!(cookie(&["theme=dark"]), None);
        assert_eq!(cookie(&["taskToken="]), None); // what logging out leaves behind
        assert_eq!(cookie(&["taskTokenX=abc"]), None);
    }

    // These tokens are from 2026-10-28 and only last a day, so the tests don't check the expiry date
    fn checking_without_expiry() -> Validation {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.validate_exp = false;
        validation.required_spec_claims.clear();
        validation
    }

    #[test]
    fn reads_tokens_made_by_nestjs() {
        // Made by NestJS's JwtService (auth.module.ts settings) with the secret "a secret", for { sub: 409, ver: 3 }
        let from_nestjs = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjQwOSwidmVyIjozLCJpYXQiOjE3OTMxNzU4OTcsImV4cCI6MTc5MzI2MjI5N30.q1BrlxxA0EbwCQRKUyD6N_-oJbM27eYRscZoRtR5Vpo";

        let read = decode::<Claims>(
            from_nestjs,
            &JwtKeys::new("a secret").checking,
            &checking_without_expiry(),
        )
        .unwrap();

        assert_eq!(
            (read.claims.sub, read.claims.ver, read.claims.exp - read.claims.iat),
            (409, Some(3), 86_400)
        );
        // Signed with another secret: refused
        assert!(
            decode::<Claims>(
                from_nestjs,
                &JwtKeys::new("another").checking,
                &checking_without_expiry()
            )
            .is_err()
        );
    }

    #[test]
    fn makes_tokens_with_the_same_fields_and_lifetime() {
        let keys = JwtKeys::new("a secret");
        let claims = Claims {
            sub: 409,
            ver: Some(0),
            iat: 1_793_175_340,
            exp: 1_793_175_340 + TOKEN_LIFETIME_SECONDS,
        };

        let token = encode(&Header::new(Algorithm::HS256), &claims, &keys.signing).unwrap();

        let read = decode::<Claims>(&token, &keys.checking, &checking_without_expiry())
            .unwrap()
            .claims;
        assert_eq!((read.sub, read.ver, read.exp - read.iat), (409, Some(0), 86_400));
    }
}
