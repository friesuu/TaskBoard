//! The account settings in the profile: the display name, and deleting the account (the account module in
//! NestJS, ../backend/src/account). The time zone and the password are in auth/, as in NestJS.
//!
//! Small enough for one file, in the same parts as the bigger modules' files: what the operations take, the
//! GraphQL operations, and the service.

use std::path::Path;
use std::sync::Arc;

use async_graphql::{Context, InputObject, Object};
use sqlx::PgPool;

use crate::attachments::{remove_stored_files, storage_keys_owned_by};
use crate::auth::{clear_login_cookie, current_user, password_is};
use crate::config::Config;
use crate::errors::{bad_request, internal};
use crate::throttle::limit_by_account;
use crate::users::{self, User};
use crate::validate;

// ======================= What the operations take (display-name.dto.ts, delete-account.dto.ts) =======================

#[derive(InputObject)]
#[graphql(name = "DisplayNameInput")]
pub struct DisplayNameInput {
    display_name: String,
}

impl DisplayNameInput {
    /// The name trimmed, then the rules
    fn checked(mut self) -> async_graphql::Result<Self> {
        self.display_name = validate::js_trim(&self.display_name).to_string();
        validate::check([
            // @IsString @MaxLength(50) @Matches(no invisible characters): bottom up, as NestJS does
            validate::no_hidden_characters(&self.display_name),
            validate::at_most("displayName", &self.display_name, 50),
        ])?;
        Ok(self)
    }
}

#[derive(InputObject)]
#[graphql(name = "DeleteAccountInput")]
pub struct DeleteAccountInput {
    password: String,
}

impl DeleteAccountInput {
    fn checked(self) -> async_graphql::Result<Self> {
        validate::check([
            // @IsString @IsNotEmpty @MaxLength(128), bottom up
            validate::at_most("password", &self.password, 128),
            validate::not_empty("password", &self.password),
        ])?;
        Ok(self)
    }
}

// ======================= The GraphQL operations (account.resolver.ts) =======================

/// The account part of the GraphQL Mutation type
#[derive(Default)]
pub struct AccountMutation;

#[Object]
impl AccountMutation {
    /// The name shown instead of the email. Spaces around it are trimmed; an empty one removes it.
    async fn set_display_name(&self, ctx: &Context<'_>, input: DisplayNameInput) -> async_graphql::Result<User> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        set_display_name(ctx.data::<PgPool>()?, user.id, &input.display_name).await
    }

    /// Deletes the account and everything in it. Asks for the password again, and is rate limited per account
    /// (5 a minute), so nobody at an unlocked computer can guess it. Logs out.
    async fn delete_account(&self, ctx: &Context<'_>, input: DeleteAccountInput) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        limit_by_account(ctx, "deleteAccount", &user)?;
        let input = input.checked()?;
        let upload_dir = &ctx.data::<Arc<Config>>()?.upload_dir;
        delete_account(ctx.data::<PgPool>()?, upload_dir, user.id, input.password).await?;
        clear_login_cookie(ctx)?;
        Ok(true)
    }
}

// ======================= The service (account.service.ts): the work, with no GraphQL in it =======================

/// `name` is already trimmed and checked; an empty one removes the name (the email is shown again)
pub async fn set_display_name(db: &PgPool, user_id: i32, name: &str) -> async_graphql::Result<User> {
    // `then_some`: Some(name) if it isn't empty, None if it is
    let name = (!name.is_empty()).then_some(name);
    users::set_display_name(db, user_id, name).await.map_err(internal)
}

/// Deletes the account and everything in it: boards, tasks, labels, checklists, comments, chat (the database
/// deletes those with the user: ON DELETE CASCADE) and the uploaded files. Only with the right password.
pub async fn delete_account(
    db: &PgPool,
    upload_dir: &Path,
    user_id: i32,
    password: String,
) -> async_graphql::Result<()> {
    // BAD_REQUEST, not UNAUTHENTICATED: the frontend would log you out on UNAUTHENTICATED
    if !password_is(db, user_id, password).await? {
        return Err(bad_request("Password is incorrect"));
    }
    let files = storage_keys_owned_by(db, user_id).await.map_err(internal)?; // before their rows are gone
    users::delete(db, user_id).await.map_err(internal)?;
    remove_stored_files(upload_dir, &files).await;
    Ok(())
}
