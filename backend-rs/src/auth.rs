//! Logging in and out, registering, changing the password and the time zone: auth.resolver.ts and
//! auth.service.ts in NestJS. And the login cookie: a JWT in the httpOnly cookie "taskToken", saying who you
//! are (`sub`, your user id) and which password "generation" it was made for (`ver`, your token version).
//!
//! Each operation does its steps in NestJS's order, because that decides which error you get when several
//! things are wrong: the login check, then the rate limit, then the input rules, then the work.

use std::net::IpAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use async_graphql::{Context, InputObject, Object};
use axum::http::HeaderMap;
use axum::http::header::{COOKIE, SET_COOKIE};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::config::Config;
use crate::cookies::{self, AUTH_COOKIE};
use crate::errors::{bad_request, conflict, internal, unauthorized, unauthorized_because};
use crate::passwords::{self, DummyHash};
use crate::throttle::RateLimits;
use crate::users::{self, User};
use crate::validate;

/// How long a login token lasts: one day (JwtModule's expiresIn: '1d' in NestJS)
const TOKEN_LIFETIME_SECONDS: u64 = 24 * 60 * 60;

/// How many tries a minute the rate limited operations allow (ThrottlerModule's default in app.module.ts)
const TRIES_PER_MINUTE: usize = 5;

/// One request's login cookie (None: it didn't have one), handed to the GraphQL resolvers with the request.
/// A struct around one value (a "newtype"), so it can't be mixed up with any other `Option<String>`.
pub struct LoginCookie(pub Option<String>);

/// Who sent the request (throttle::client_address), for the limits that count by address
pub struct ClientAddress(pub IpAddr);

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

/// Is this the user's password? Asked again before changing the password or deleting the account, even though
/// they're logged in: someone at an unlocked computer shouldn't be able to do either.
pub async fn password_is(ctx: &Context<'_>, user_id: i32, password: String) -> async_graphql::Result<bool> {
    let db = ctx.data::<PgPool>()?;
    let Some(found) = users::find_with_password(db, user_id).await.map_err(internal)? else {
        return Ok(false);
    };
    Ok(passwords::matches(password, found.password_hash).await)
}

/// One try at a rate limited operation, counted by the sender's address (nobody is logged in yet)
pub fn limit_by_address(ctx: &Context<'_>, operation: &str) -> async_graphql::Result<()> {
    let address = ctx.data::<ClientAddress>()?.0;
    ctx.data::<RateLimits>()?
        .check(operation, &address.to_string(), TRIES_PER_MINUTE)
}

/// One try at a rate limited operation, counted by account (the login check has already run)
pub fn limit_by_account(ctx: &Context<'_>, operation: &str, user: &User) -> async_graphql::Result<()> {
    ctx.data::<RateLimits>()?
        .check(operation, &format!("user-{}", user.id), TRIES_PER_MINUTE)
}

/// A new login token for this user, and the cookie that puts it in the browser
fn set_login_cookie(ctx: &Context<'_>, user: &User) -> async_graphql::Result<()> {
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

/// Emails are saved trimmed and in lowercase, and looked up that way (the @Transform in register.dto.ts)
fn normalized_email(email: &str) -> String {
    validate::js_trim(email).to_lowercase()
}

// The inputs. The names in #[graphql(name)] are the GraphQL types' names in NestJS's schema; the fields become
// camelCase (current_password -> currentPassword), like the DTOs' fields.

#[derive(InputObject)]
#[graphql(name = "RegisterInput")]
pub struct RegisterInput {
    email: String,
    password: String,
}

#[derive(InputObject)]
#[graphql(name = "LoginInput")]
pub struct LoginInput {
    email: String,
    password: String,
}

#[derive(InputObject)]
#[graphql(name = "ChangePasswordInput")]
pub struct ChangePasswordInput {
    current_password: String,
    new_password: String,
}

#[derive(InputObject)]
#[graphql(name = "TimeZoneInput")]
pub struct TimeZoneInput {
    time_zone: String,
}

/// The auth part of the GraphQL Mutation type
#[derive(Default)]
pub struct AuthMutation;

#[Object]
impl AuthMutation {
    /// A new account, with its first board. Rate limited (5 a minute per address): stops scripts making
    /// accounts in bulk. Doesn't log in: the app logs in right after.
    async fn register(&self, ctx: &Context<'_>, input: RegisterInput) -> async_graphql::Result<User> {
        limit_by_address(ctx, "register")?;
        let email = normalized_email(&input.email);
        validate::check([
            validate::email("email", &email),
            // @MinLength(8) @MaxLength(128): checked bottom up, as NestJS does
            validate::at_most("password", &input.password, 128),
            validate::at_least("password", &input.password, 8),
        ])?;

        let db = ctx.data::<PgPool>()?;
        if users::find_by_email(db, &email).await.map_err(internal)?.is_some() {
            return Err(conflict("Email is already registered"));
        }
        let hash = passwords::hash(input.password).await.map_err(internal)?;
        users::create(db, &email, &hash).await.map_err(|err| {
            // Someone registered the same email between the check above and now
            if users::is_duplicate(&err) {
                conflict("Email is already registered")
            } else {
                internal(err)
            }
        })
    }

    /// Logs in: the login cookie is set on the answer. Rate limited (5 a minute per address): stops password guessing.
    async fn login(&self, ctx: &Context<'_>, input: LoginInput) -> async_graphql::Result<User> {
        limit_by_address(ctx, "login")?;
        let email = normalized_email(&input.email);
        validate::check([
            validate::email("email", &email),
            // @IsString @IsNotEmpty @MaxLength(128), bottom up
            validate::at_most("password", &input.password, 128),
            validate::not_empty("password", &input.password),
        ])?;

        let db = ctx.data::<PgPool>()?;
        let found = users::find_by_email(db, &email).await.map_err(internal)?;
        // No such account: the password is still checked (against DummyHash), so this takes as long as a
        // wrong password, and the answer is the same: nobody can find out which emails have an account
        let hash = match &found {
            Some(found) => found.password_hash.clone(),
            None => ctx.data::<DummyHash>()?.0.clone(),
        };
        let right = passwords::matches(input.password, hash).await;
        match found {
            Some(found) if right => {
                set_login_cookie(ctx, &found.user)?;
                Ok(found.user)
            }
            _ => Err(unauthorized_because("Invalid email or password")),
        }
    }

    /// Tells the browser to delete the login cookie. Works logged in or not.
    async fn logout(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        clear_login_cookie(ctx)?;
        Ok(true)
    }

    /// The browser's time zone, sent after logging in, so "today" is today where the user is
    async fn set_time_zone(&self, ctx: &Context<'_>, input: TimeZoneInput) -> async_graphql::Result<User> {
        let user = current_user(ctx).await?;
        validate::check([validate::time_zone("timeZone", &input.time_zone)])?;
        users::set_time_zone(ctx.data::<PgPool>()?, user.id, &input.time_zone)
            .await
            .map_err(internal)
    }

    /// A new password. Every other device is logged out (their tokens have the old version); this one gets a
    /// fresh cookie and stays logged in. Rate limited per account (5 a minute): nobody at an unlocked computer
    /// can guess the current password.
    async fn change_password(&self, ctx: &Context<'_>, input: ChangePasswordInput) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        limit_by_account(ctx, "changePassword", &user)?;
        validate::check([
            // currentPassword: @IsString @IsNotEmpty @MaxLength(128), bottom up
            validate::at_most("currentPassword", &input.current_password, 128),
            validate::not_empty("currentPassword", &input.current_password),
            // newPassword: @MinLength(8) @MaxLength(128), bottom up
            validate::at_most("newPassword", &input.new_password, 128),
            validate::at_least("newPassword", &input.new_password, 8),
        ])?;

        // BAD_REQUEST, not UNAUTHENTICATED: the frontend would log you out on UNAUTHENTICATED
        if !password_is(ctx, user.id, input.current_password.clone()).await? {
            return Err(bad_request("Current password is incorrect"));
        }
        if input.new_password == input.current_password {
            return Err(bad_request("New password must be different from the current one"));
        }
        let hash = passwords::hash(input.new_password).await.map_err(internal)?;
        let user = users::set_password(ctx.data::<PgPool>()?, user.id, &hash)
            .await
            .map_err(internal)?;
        set_login_cookie(ctx, &user)?; // a token with the new version
        Ok(true)
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

    #[test]
    fn emails_are_trimmed_and_lowercase() {
        assert_eq!(normalized_email("  Capture-A@Test.COM "), "capture-a@test.com");
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
