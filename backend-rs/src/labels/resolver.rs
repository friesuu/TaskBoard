//! The label operations in GraphQL (labels.resolver.ts in NestJS). Each does the same three things, in NestJS's
//! order: who's logged in (NestJS's GqlAuthGuard), the input rules (its ValidationPipe), then the service.

use async_graphql::{Context, Object};
use sqlx::PgPool;

use super::inputs::{LabelInput, SetTaskLabelsInput, UpdateLabelInput};
use super::service;
use super::types::Label;
use crate::auth::current_user;
use crate::tasks::Task;

/// The labels part of the GraphQL Query type
#[derive(Default)]
pub struct LabelsQuery;

#[Object]
impl LabelsQuery {
    /// A board's labels, A to Z. Someone else's board: "Board 7 not found".
    async fn labels(&self, ctx: &Context<'_>, board_id: i32) -> async_graphql::Result<Vec<Label>> {
        let user = current_user(ctx).await?;
        service::of_board(ctx.data::<PgPool>()?, board_id, user.id).await
    }
}

/// The labels part of the GraphQL Mutation type
#[derive(Default)]
pub struct LabelsMutation;

#[Object]
impl LabelsMutation {
    async fn create_label(&self, ctx: &Context<'_>, board_id: i32, input: LabelInput) -> async_graphql::Result<Label> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        service::create(ctx.data::<PgPool>()?, board_id, input, user.id).await
    }

    /// Rename and/or recolour
    async fn update_label(&self, ctx: &Context<'_>, id: i32, input: UpdateLabelInput) -> async_graphql::Result<Label> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        service::update(ctx.data::<PgPool>()?, id, input, user.id).await
    }

    async fn delete_label(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        service::remove(ctx.data::<PgPool>()?, id, user.id).await?;
        Ok(true)
    }

    /// Replaces a task's labels ([] removes them all). Answers with the task and its new labels.
    async fn set_task_labels(
        &self,
        ctx: &Context<'_>,
        task_id: i32,
        input: SetTaskLabelsInput,
    ) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        service::set_task_labels(ctx.data::<PgPool>()?, task_id, input.label_ids, user.id).await
    }
}
