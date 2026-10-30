//! The task operations in GraphQL (tasks.resolver.ts in NestJS). Each does the same three things, in NestJS's
//! order: who's logged in (NestJS's GqlAuthGuard), the input rules (its ValidationPipe), then the service.

use async_graphql::{Context, Object};
use sqlx::PgPool;

use super::inputs::{CreateTaskInput, MoveTaskInput, TaskFilterInput, UpdateTaskInput};
use super::service;
use super::types::{Task, TaskStats};
use crate::auth::current_user;

/// The tasks part of the GraphQL Query type
#[derive(Default)]
pub struct TasksQuery;

#[Object]
impl TasksQuery {
    /// One board's tasks, column by column in order, each with its labels. Someone else's board: no tasks.
    async fn tasks(
        &self,
        ctx: &Context<'_>,
        board_id: i32,
        filter: Option<TaskFilterInput>,
    ) -> async_graphql::Result<Vec<Task>> {
        let user = current_user(ctx).await?;
        let filter = filter.unwrap_or_default().checked()?;
        service::find_all(
            ctx.data::<PgPool>()?,
            user.id,
            board_id,
            filter,
            user.time_zone.as_deref(),
        )
        .await
    }

    /// The profile's numbers, across all your boards. "Today" and "this week" are the user's own.
    async fn task_stats(&self, ctx: &Context<'_>) -> async_graphql::Result<TaskStats> {
        let user = current_user(ctx).await?;
        service::stats(ctx.data::<PgPool>()?, user.id, user.time_zone.as_deref()).await
    }
}

/// The tasks part of the GraphQL Mutation type
#[derive(Default)]
pub struct TasksMutation;

#[Object]
impl TasksMutation {
    /// A new task at the bottom of its column, on one of your boards
    async fn create_task(&self, ctx: &Context<'_>, input: CreateTaskInput) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        service::create(ctx.data::<PgPool>()?, input, user.id).await
    }

    async fn update_task(&self, ctx: &Context<'_>, id: i32, input: UpdateTaskInput) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        service::update(ctx.data::<PgPool>()?, id, input, user.id).await
    }

    /// Drag and drop: a task to a position in a column of its board
    async fn move_task(&self, ctx: &Context<'_>, id: i32, input: MoveTaskInput) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        service::move_to(ctx.data::<PgPool>()?, id, input, user.id).await
    }

    async fn delete_task(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        service::remove(ctx.data::<PgPool>()?, id, user.id).await?;
        Ok(true)
    }
}
