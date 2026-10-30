//! The runner's key to your task board (runner-tokens.service.ts and runner-auth.guard.ts in NestJS). One per
//! user. Only its SHA-256 hash is saved, like a password: the token itself is shown once, when it's made.
//!
//! The runner isn't a browser, so it has no login cookie: it sends its token in a header, "Authorization: Bearer
//! tbr_...". `runner_user` is the login check for the runner's own operations, and reads only that header;
//! `auth::current_user`, the login check for everything else, reads only the cookie. So the token can't reach
//! anything but the runner's operations (deleting tasks, changing your password...), and your cookie can't
//! reach the runner's.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use async_graphql::Context;
use axum::http::HeaderMap;
use axum::http::header::AUTHORIZATION;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use super::types::RunnerTokenInfo;
use crate::errors::{internal, unauthorized};
use crate::users::{self, User};

/// Every runner token starts with this, so one is easy to recognise (e.g. if it ever ends up somewhere it
/// shouldn't: redact.rs hides anything that looks like one)
const PREFIX: &str = "tbr_";

/// One request's runner token (None: it didn't send one), handed to the GraphQL resolvers with the request,
/// like the login cookie (auth::LoginCookie)
pub struct BearerToken(Option<String>);

/// The token from the request's "Authorization: Bearer <token>" header: everything after "Bearer ", as NestJS
/// takes it. Any other kind of Authorization header (e.g. "Basic ...") is no token.
pub fn bearer_token(headers: &HeaderMap) -> BearerToken {
    let token = headers
        .get(AUTHORIZATION) // the first one, as Node keeps only the first
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "))
        .map(str::to_string);
    BearerToken(token)
}

/// The login check for the runner's operations: the user whose runner token came with the request, or
/// "Unauthorized" (RunnerAuthGuard in NestJS)
pub async fn runner_user(ctx: &Context<'_>) -> async_graphql::Result<User> {
    let token = ctx.data_opt::<BearerToken>().and_then(|token| token.0.as_deref());
    user_for_token(ctx.data::<PgPool>()?, token).await
}

/// SHA-256, as 64 hex characters. A fast hash is fine here (unlike passwords): the token is 32 random bytes,
/// so nobody can guess it, and there's nothing to slow down. It also lets us find the row by its hash.
fn hash_of(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Your token's details (never the token itself), or None if you haven't made one
pub async fn info(db: &PgPool, owner_id: i32) -> async_graphql::Result<Option<RunnerTokenInfo>> {
    sqlx::query_as("SELECT created_at, last_used_at FROM runner_tokens WHERE owner_id = $1")
        .bind(owner_id)
        .fetch_optional(db)
        .await
        .map_err(internal)
}

/// A new token, replacing (revoking) any old one: "tbr_" and 32 random bytes in base64url, 47 characters.
/// Given back here once and never again: only its hash is saved.
pub async fn create(db: &PgPool, owner_id: i32) -> async_graphql::Result<String> {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token = format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes));

    // One row per user (owner_id is unique): a new one, or the old one made new. NestJS deletes the old row and
    // adds a new one, in a transaction; one statement does the same, and two at once can't both add a row.
    sqlx::query(
        "INSERT INTO runner_tokens (owner_id, token_hash) VALUES ($1, $2)
         ON CONFLICT (owner_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now(), last_used_at = NULL",
    )
    .bind(owner_id)
    .bind(hash_of(&token))
    .execute(db)
    .await
    .map_err(internal)?;
    Ok(token)
}

pub async fn revoke(db: &PgPool, owner_id: i32) -> async_graphql::Result<()> {
    sqlx::query("DELETE FROM runner_tokens WHERE owner_id = $1")
        .bind(owner_id)
        .execute(db)
        .await
        .map_err(internal)?;
    Ok(())
}

/// Who a token belongs to. A missing, malformed, revoked or made-up token gives the same "Unauthorized".
/// Each use is written down (last_used_at), so the profile shows the runner is alive, or use you didn't expect.
pub async fn user_for_token(db: &PgPool, token: Option<&str>) -> async_graphql::Result<User> {
    let Some(token) = token.filter(|token| token.starts_with(PREFIX)) else {
        return Err(unauthorized());
    };
    let owner_id: Option<i32> =
        sqlx::query_scalar("UPDATE runner_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING owner_id")
            .bind(hash_of(token))
            .fetch_optional(db)
            .await
            .map_err(internal)?;
    let Some(owner_id) = owner_id else {
        return Err(unauthorized());
    };
    users::find(db, owner_id)
        .await
        .map_err(internal)?
        .ok_or_else(unauthorized)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(headers: &[&str]) -> Option<String> {
        let mut map = HeaderMap::new();
        for header in headers {
            map.append(AUTHORIZATION, header.parse().unwrap());
        }
        bearer_token(&map).0
    }

    #[test]
    fn reads_the_bearer_token() {
        assert_eq!(token(&["Bearer tbr_abc"]), Some("tbr_abc".to_string()));
        assert_eq!(
            token(&["Bearer tbr_first", "Bearer tbr_second"]),
            Some("tbr_first".to_string())
        );
        assert_eq!(token(&["Basic tbr_abc"]), None);
        assert_eq!(token(&["bearer tbr_abc"]), None); // "Bearer " exactly, as in NestJS
        assert_eq!(token(&[]), None);
    }

    #[test]
    fn hashes_like_node() {
        // createHash('sha256').update('tbr_abc').digest('hex') in Node
        assert_eq!(
            hash_of("tbr_abc"),
            "5c6e565d4aed195d66595b7fceb011cd5e488b9a05f567a6394b1e0fa275a590"
        );
    }
}
