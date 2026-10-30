//! The checklist operations in GraphQL (checklist.resolver.ts in NestJS). Each does the same three things, in
//! NestJS's order: who's logged in, the input rules, then the service.

use async_graphql::{Context, Object};
use sqlx::PgPool;

use crate::auth::current_user;
use crate::checklist::service;

use super::inputs::{ChecklistItemInput, UpdateChecklistItemInput};
use super::types::ChecklistItem;

// ===================================== YOUR PART (phase 5) =====================================
// Part 2 of 2: the five operation bodies. tasks/resolver.rs is the pattern to follow: the login check
// (`current_user(ctx).await?`), then the input rules (`input.checked()?`, for the operations with an input), then
// the service function of the same job in service.rs, with the database from `ctx.data::<PgPool>()?`.
//
// The `use` lines you'll need aren't at the top yet: write the code first, and `cargo build` tells you what it
// can't find, and often the exact `use` line to add ("help: consider importing this function").
//
// Mind the order of the service functions' arguments: they follow checklist.service.ts (task_id or id first,
// then whose it is: `user.id`).

/// The checklist part of the GraphQL Query type
#[derive(Default)]
pub struct ChecklistQuery;

#[Object]
impl ChecklistQuery {
    /// A task's checklist, top to bottom
    async fn checklist_items(&self, ctx: &Context<'_>, task_id: i32) -> async_graphql::Result<Vec<ChecklistItem>> {
        let user = current_user(ctx).await?;
        let db = ctx.data::<PgPool>()?;
        service::find_all(db, task_id, user.id).await
    }
}

/// The checklist part of the GraphQL Mutation type
#[derive(Default)]
pub struct ChecklistMutation;

#[Object]
impl ChecklistMutation {
    /// A new item, at the bottom of the checklist
    async fn add_checklist_item(
        &self,
        ctx: &Context<'_>,
        task_id: i32,
        input: ChecklistItemInput,
    ) -> async_graphql::Result<ChecklistItem> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        let db = ctx.data::<PgPool>()?;
        service::add(db, task_id, user.id, &input.text).await
    }

    /// Tick/untick and/or rename
    async fn update_checklist_item(
        &self,
        ctx: &Context<'_>,
        id: i32,
        input: UpdateChecklistItemInput,
    ) -> async_graphql::Result<ChecklistItem> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        let db = ctx.data::<PgPool>()?;
        service::update(db, id, user.id, input).await
    }

    /// position 0 = top; past the end = bottom. Answers with the whole checklist, in its new order.
    async fn move_checklist_item(
        &self,
        ctx: &Context<'_>,
        id: i32,
        position: i32,
    ) -> async_graphql::Result<Vec<ChecklistItem>> {
        let user = current_user(ctx).await?;
        let db = ctx.data::<PgPool>()?;
        service::move_to(db, id, user.id, position).await
    }

    async fn delete_checklist_item(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        let db = ctx.data::<PgPool>()?;
        service::remove(db, id, user.id).await?;
        Ok(true)
    }
}
// ================================================================================================
