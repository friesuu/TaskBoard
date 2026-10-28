//! The account settings in the profile: the display name, and deleting the account (account.resolver.ts and
//! account.service.ts in NestJS). The time zone and the password are in auth.rs, as in NestJS.

use std::path::Path;
use std::sync::Arc;

use async_graphql::{Context, InputObject, Object};
use sqlx::PgPool;

use crate::auth::{clear_login_cookie, current_user, limit_by_account, password_is};
use crate::config::Config;
use crate::errors::{bad_request, internal};
use crate::users::{self, User};
use crate::validate;

#[derive(InputObject)]
#[graphql(name = "DisplayNameInput")]
pub struct DisplayNameInput {
    display_name: String,
}

#[derive(InputObject)]
#[graphql(name = "DeleteAccountInput")]
pub struct DeleteAccountInput {
    password: String,
}

/// The account part of the GraphQL Mutation type
#[derive(Default)]
pub struct AccountMutation;

#[Object]
impl AccountMutation {
    /// The name shown instead of the email. Spaces around it are trimmed; an empty one removes it.
    async fn set_display_name(&self, ctx: &Context<'_>, input: DisplayNameInput) -> async_graphql::Result<User> {
        let user = current_user(ctx).await?;
        let name = validate::js_trim(&input.display_name);
        validate::check([
            // @IsString @MaxLength(50) @Matches(no invisible characters): bottom up, as NestJS does
            validate::no_hidden_characters(name),
            validate::at_most("displayName", name, 50),
        ])?;

        // `then_some`: Some(name) if it isn't empty, None if it is
        let name = (!name.is_empty()).then_some(name);
        users::set_display_name(ctx.data::<PgPool>()?, user.id, name)
            .await
            .map_err(internal)
    }

    /// Deletes the account and everything in it: boards, tasks, labels, checklists, comments, chat (the database
    /// deletes those with the user: ON DELETE CASCADE) and the uploaded files. Asks for the password again, and
    /// is rate limited per account (5 a minute), so nobody at an unlocked computer can guess it. Logs out.
    async fn delete_account(&self, ctx: &Context<'_>, input: DeleteAccountInput) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        limit_by_account(ctx, "deleteAccount", &user)?;
        validate::check([
            // @IsString @IsNotEmpty @MaxLength(128), bottom up
            validate::at_most("password", &input.password, 128),
            validate::not_empty("password", &input.password),
        ])?;
        // BAD_REQUEST, not UNAUTHENTICATED: the frontend would log you out on UNAUTHENTICATED
        if !password_is(ctx, user.id, input.password).await? {
            return Err(bad_request("Password is incorrect"));
        }

        let db = ctx.data::<PgPool>()?;
        let files = stored_files_of(db, user.id).await.map_err(internal)?; // before their rows are gone
        users::delete(db, user.id).await.map_err(internal)?;
        remove_files(&ctx.data::<Arc<Config>>()?.upload_dir, &files).await;
        clear_login_cookie(ctx)?;
        Ok(true)
    }
}

/// Where every file on one user's tasks is stored (storageKeysOwnedBy in attachments.service.ts)
async fn stored_files_of(db: &PgPool, owner_id: i32) -> Result<Vec<String>, sqlx::Error> {
    // query_scalar: each row is one value (here the storage key), not a struct
    sqlx::query_scalar(
        "SELECT attachments.storage_key FROM attachments
         JOIN tasks ON tasks.id = attachments.task_id
         WHERE tasks.owner_id = $1",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await
}

/// Deletes stored files. One that can't be deleted now stays for NestJS's hourly clean-up of files no row
/// points at (removeStoredFiles in attachments.service.ts does the same).
async fn remove_files(folder: &Path, keys: &[String]) {
    for key in keys.iter().filter(|key| is_storage_key(key)) {
        if let Err(err) = tokio::fs::remove_file(folder.join(key)).await {
            tracing::warn!("Couldn't delete the stored file {key}: {err}");
        }
    }
}

/// Storage keys are 64 lowercase hex characters (storage.service.ts). Anything else is never used as a file
/// name, so a key can't point outside the upload folder (e.g. "../../.env").
fn is_storage_key(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_real_storage_keys_are_file_names() {
        assert!(is_storage_key(&"a1".repeat(32)));
        assert!(!is_storage_key("../../.env"));
        assert!(!is_storage_key(&"A1".repeat(32))); // capitals are never made
        assert!(!is_storage_key(&"a1".repeat(31)));
        assert!(!is_storage_key(&format!("{}/", "a".repeat(63))));
    }
}
