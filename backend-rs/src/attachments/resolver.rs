//! Listing and deleting files in GraphQL (attachments.resolver.ts in NestJS). Uploading and downloading are
//! normal web addresses instead (routes.rs).

use std::sync::Arc;

use async_graphql::{Context, Object};
use sqlx::PgPool;

use super::service;
use super::types::Attachment;
use crate::auth::current_user;
use crate::config::Config;

/// The attachments part of the GraphQL Query type
#[derive(Default)]
pub struct AttachmentsQuery;

#[Object]
impl AttachmentsQuery {
    /// A task's files, oldest first
    async fn attachments(&self, ctx: &Context<'_>, task_id: i32) -> async_graphql::Result<Vec<Attachment>> {
        let user = current_user(ctx).await?;
        service::find_all(ctx.data::<PgPool>()?, task_id, user.id).await
    }
}

/// The attachments part of the GraphQL Mutation type
#[derive(Default)]
pub struct AttachmentsMutation;

#[Object]
impl AttachmentsMutation {
    /// Deletes the file: its row and its bytes
    async fn delete_attachment(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        let folder = &ctx.data::<Arc<Config>>()?.upload_dir;
        service::remove(ctx.data::<PgPool>()?, folder, id, user.id).await?;
        Ok(true)
    }
}
