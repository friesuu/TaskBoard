//! The login cookie. Logging in (still NestJS's job) puts a JWT in the httpOnly cookie "taskToken": who you
//! are (`sub`, your user id) and which password "generation" it was made for (`ver`, your token version).
//! It's checked here the way NestJS's AuthService.userFromToken checks it.

use async_graphql::Context;
use axum::http::HeaderMap;
use axum::http::header::COOKIE;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::Deserialize;
use sqlx::PgPool;

use crate::errors::{internal, unauthorized};
use crate::users::{self, User};

pub const AUTH_COOKIE: &str = "taskToken";

/// One request's login cookie (None: it didn't have one), handed to the GraphQL resolvers with the request.
/// A struct around one value (a "newtype"), so it can't be mixed up with any other `Option<String>`.
pub struct LoginCookie(pub Option<String>);

/// The key that checks a token's signature, made once from JWT_SECRET and kept in the schema
pub struct JwtKey(DecodingKey);

impl JwtKey {
    pub fn new(secret: &str) -> JwtKey {
        JwtKey(DecodingKey::from_secret(secret.as_bytes()))
    }
}

/// What's inside the token. serde fills it in from the token's JSON. `ver` is an Option because tokens from
/// before token versions existed don't have one (those never match, like in NestJS).
#[derive(Deserialize)]
struct Claims {
    sub: i32,
    ver: Option<i32>,
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
    let key = ctx.data::<JwtKey>()?;
    // HS256: how NestJS's JwtModule signs. The expiry date (exp, a day after logging in) is checked too.
    let Ok(token) = decode::<Claims>(token, &key.0, &Validation::new(Algorithm::HS256)) else {
        return Err(unauthorized());
    };

    let db = ctx.data::<PgPool>()?;
    match users::find(db, token.claims.sub).await.map_err(internal)? {
        // `if` in a match arm: this arm only counts when the token versions match too
        Some(user) if Some(user.token_version) == token.claims.ver => Ok(user),
        _ => Err(unauthorized()),
    }
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
}
