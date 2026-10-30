//! Logging in and out, registering, the password and the time zone in GraphQL (auth.resolver.ts in NestJS).
//! Each operation does its steps in NestJS's order, because that decides which error you get when several
//! things are wrong: the login check, then the rate limit, then the input rules, then the service.

use async_graphql::{Context, Object};
use sqlx::PgPool;

use super::inputs::{ChangePasswordInput, LoginInput, RegisterInput, TimeZoneInput};
use super::service;
use super::session::{clear_login_cookie, current_user, set_login_cookie};
use crate::passwords::DummyHash;
use crate::throttle::{limit_by_account, limit_by_address};
use crate::users::User;

/// The auth part of the GraphQL Mutation type
#[derive(Default)]
pub struct AuthMutation;

#[Object]
impl AuthMutation {
    /// A new account, with its first board. Rate limited (5 a minute per address): stops scripts making
    /// accounts in bulk. Doesn't log in: the app logs in right after.
    async fn register(&self, ctx: &Context<'_>, input: RegisterInput) -> async_graphql::Result<User> {
        limit_by_address(ctx, "register")?;
        let input = input.checked()?;
        service::register(ctx.data::<PgPool>()?, input).await
    }

    /// Logs in: the login cookie is set on the answer. Rate limited (5 a minute per address): stops password guessing.
    async fn login(&self, ctx: &Context<'_>, input: LoginInput) -> async_graphql::Result<User> {
        limit_by_address(ctx, "login")?;
        let input = input.checked()?;
        let user = service::login(ctx.data::<PgPool>()?, ctx.data::<DummyHash>()?, input).await?;
        set_login_cookie(ctx, &user)?;
        Ok(user)
    }

    /// Tells the browser to delete the login cookie. Works logged in or not.
    async fn logout(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        clear_login_cookie(ctx)?;
        Ok(true)
    }

    /// The browser's time zone, sent after logging in, so "today" is today where the user is
    async fn set_time_zone(&self, ctx: &Context<'_>, input: TimeZoneInput) -> async_graphql::Result<User> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        service::set_time_zone(ctx.data::<PgPool>()?, user.id, &input.time_zone).await
    }

    /// A new password. Every other device is logged out (their tokens have the old version); this one gets a
    /// fresh cookie and stays logged in. Rate limited per account (5 a minute): nobody at an unlocked computer
    /// can guess the current password.
    async fn change_password(&self, ctx: &Context<'_>, input: ChangePasswordInput) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        limit_by_account(ctx, "changePassword", &user)?;
        let input = input.checked()?;
        let user = service::change_password(ctx.data::<PgPool>()?, user.id, input).await?;
        set_login_cookie(ctx, &user)?; // a token with the new version
        Ok(true)
    }
}
