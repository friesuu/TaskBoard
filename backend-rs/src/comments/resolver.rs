//! The comment operations in GraphQL (comments.resolver.ts in NestJS): the login check, the input rules, then
//! the service

use async_graphql::{Context, Object};
use sqlx::PgPool;

use super::inputs::CommentInput;
use super::service;
use super::types::Comment;
use crate::auth::current_user;

/// The comments part of the GraphQL Query type
#[derive(Default)]
pub struct CommentsQuery;

#[Object]
impl CommentsQuery {
    /// A task's comments, oldest first
    async fn comments(&self, ctx: &Context<'_>, task_id: i32) -> async_graphql::Result<Vec<Comment>> {
        let user = current_user(ctx).await?;
        service::find_all(ctx.data::<PgPool>()?, task_id, user.id).await
    }
}

/// The comments part of the GraphQL Mutation type
#[derive(Default)]
pub struct CommentsMutation;

#[Object]
impl CommentsMutation {
    async fn add_comment(
        &self,
        ctx: &Context<'_>,
        task_id: i32,
        input: CommentInput,
    ) -> async_graphql::Result<Comment> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        service::add(ctx.data::<PgPool>()?, task_id, user.id, &input.body).await
    }

    async fn update_comment(&self, ctx: &Context<'_>, id: i32, input: CommentInput) -> async_graphql::Result<Comment> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        service::update(ctx.data::<PgPool>()?, id, user.id, &input.body).await
    }

    async fn delete_comment(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        service::remove(ctx.data::<PgPool>()?, id, user.id).await?;
        Ok(true)
    }
}
