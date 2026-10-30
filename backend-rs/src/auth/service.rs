//! The work behind logging in, registering and the password and time zone settings (auth.service.ts in NestJS):
//! plain functions that take the database and the inputs (already checked). No GraphQL in here.

use sqlx::PgPool;

use super::inputs::{ChangePasswordInput, LoginInput, RegisterInput};
use crate::errors::{bad_request, conflict, internal, unauthorized_because};
use crate::passwords::{self, DummyHash};
use crate::users::{self, User};

/// A new account, with its first board. Doesn't log in: the app logs in right after.
pub async fn register(db: &PgPool, input: RegisterInput) -> async_graphql::Result<User> {
    if users::find_by_email(db, &input.email)
        .await
        .map_err(internal)?
        .is_some()
    {
        return Err(conflict("Email is already registered"));
    }
    let hash = passwords::hash(input.password).await.map_err(internal)?;
    users::create(db, &input.email, &hash).await.map_err(|err| {
        // Someone registered the same email between the check above and now
        if users::is_duplicate(&err) {
            conflict("Email is already registered")
        } else {
            internal(err)
        }
    })
}

/// The user, if the email and password are right (the resolver then sets the login cookie)
pub async fn login(db: &PgPool, dummy_hash: &DummyHash, input: LoginInput) -> async_graphql::Result<User> {
    let found = users::find_by_email(db, &input.email).await.map_err(internal)?;
    // No such account: the password is still checked (against DummyHash), so this takes as long as a wrong
    // password, and the answer is the same: nobody can find out which emails have an account
    let hash = match &found {
        Some(found) => found.password_hash.clone(),
        None => dummy_hash.0.clone(),
    };
    let right = passwords::matches(input.password, hash).await;
    match found {
        Some(found) if right => Ok(found.user),
        _ => Err(unauthorized_because("Invalid email or password")),
    }
}

/// The browser's time zone (already checked), so "today" is today where the user is
pub async fn set_time_zone(db: &PgPool, user_id: i32, time_zone: &str) -> async_graphql::Result<User> {
    users::set_time_zone(db, user_id, time_zone).await.map_err(internal)
}

/// A new password. Gives back the user with their new token version: every login token made before now stops
/// working (the resolver gives this device a new one).
pub async fn change_password(db: &PgPool, user_id: i32, input: ChangePasswordInput) -> async_graphql::Result<User> {
    // BAD_REQUEST, not UNAUTHENTICATED: the frontend would log you out on UNAUTHENTICATED
    if !password_is(db, user_id, input.current_password.clone()).await? {
        return Err(bad_request("Current password is incorrect"));
    }
    if input.new_password == input.current_password {
        return Err(bad_request("New password must be different from the current one"));
    }
    let hash = passwords::hash(input.new_password).await.map_err(internal)?;
    users::set_password(db, user_id, &hash).await.map_err(internal)
}

/// Is this the user's password? Asked again before changing the password or deleting the account, even though
/// they're logged in: someone at an unlocked computer shouldn't be able to do either.
pub async fn password_is(db: &PgPool, user_id: i32, password: String) -> async_graphql::Result<bool> {
    let Some(found) = users::find_with_password(db, user_id).await.map_err(internal)? else {
        return Ok(false);
    };
    Ok(passwords::matches(password, found.password_hash).await)
}
