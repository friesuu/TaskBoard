//! The bell in the header (the notifications module in NestJS, ../backend/src/notifications). Only things you
//! need to act on or know about: a prompt to approve, a build to review, a failed run, the usage limit, a merge.
//! The runner's side adds them (`notify`, called from src/runner/); you read them and mark them read. Only ever
//! your own.
//!
//! Small enough for one file, in the same parts as the bigger modules' files.

use std::collections::HashMap;

use async_graphql::{Context, Object, SimpleObject};
use sqlx::PgPool;

use crate::auth::current_user;
use crate::errors::{internal, not_found};
use crate::scalars::DateTime;
use crate::tasks::{self, Task};

/// How many the bell lists
const LATEST: i64 = 30;

// ======================= What the API shows (notification.entity.ts) =======================

/// One notification in the bell
#[derive(SimpleObject)]
pub struct Notification {
    pub id: i32,
    // The task it's about, or none ("usage limit reached"). NestJS loads only the task's id, title and boardId
    // (all the bell shows), so asking it for any other field of the task is an error; here it's the whole task.
    pub task: Option<Task>,
    pub task_id: Option<i32>,
    pub kind: String,
    pub message: String,
    pub created_at: DateTime,
    pub read_at: Option<DateTime>, // empty until you've read it
}

// ======================= The GraphQL operations (notifications.resolver.ts) =======================

/// The notifications part of the GraphQL Query type
#[derive(Default)]
pub struct NotificationsQuery;

#[Object]
impl NotificationsQuery {
    /// Your newest 30, newest first
    async fn notifications(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<Notification>> {
        let user = current_user(ctx).await?;
        find_latest(ctx.data::<PgPool>()?, user.id).await
    }

    async fn unread_notification_count(&self, ctx: &Context<'_>) -> async_graphql::Result<i32> {
        let user = current_user(ctx).await?;
        unread_count(ctx.data::<PgPool>()?, user.id).await
    }
}

/// The notifications part of the GraphQL Mutation type
#[derive(Default)]
pub struct NotificationsMutation;

#[Object]
impl NotificationsMutation {
    async fn mark_notification_read(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<Notification> {
        let user = current_user(ctx).await?;
        mark_read(ctx.data::<PgPool>()?, id, user.id).await
    }

    /// Gives back how many were marked
    async fn mark_all_notifications_read(&self, ctx: &Context<'_>) -> async_graphql::Result<i32> {
        let user = current_user(ctx).await?;
        mark_all_read(ctx.data::<PgPool>()?, user.id).await
    }
}

// ======================= The service (notifications.service.ts): the work, with no GraphQL in it =======================

/// One row of the notifications table, without its task
#[derive(sqlx::FromRow)]
struct Row {
    id: i32,
    task_id: Option<i32>,
    kind: String,
    message: String,
    created_at: DateTime,
    read_at: Option<DateTime>,
}

/// Adds one to the bell. Called by the runner's side when something happens (src/runner/jobs.rs, activity.rs).
/// `kind`: prompt_ready, review_ready, run_failed, usage_limit or merged. The message is cut to 200, counted
/// the way JavaScript counts (UTF-16 units, an emoji is 2), as NestJS's message.slice(0, 200) does.
pub async fn notify(
    db: &PgPool,
    user_id: i32,
    kind: &str,
    message: &str,
    task_id: Option<i32>,
) -> async_graphql::Result<()> {
    sqlx::query("INSERT INTO notifications (user_id, kind, message, task_id) VALUES ($1, $2, $3, $4)")
        .bind(user_id)
        .bind(kind)
        .bind(cut_to_units(message, 200))
        .bind(task_id)
        .execute(db)
        .await
        .map_err(internal)?;
    Ok(())
}

/// The first `units` UTF-16 units of a text. A cut through the middle of an emoji leaves half of it in
/// JavaScript, which the database gets as "�": the same here.
fn cut_to_units(text: &str, units: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().take(units).collect();
    String::from_utf16_lossy(&units)
}

/// Your newest notifications, newest first, each with its task
pub async fn find_latest(db: &PgPool, user_id: i32) -> async_graphql::Result<Vec<Notification>> {
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT id, task_id, kind, message, created_at, read_at FROM notifications
         WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2",
    )
    .bind(user_id)
    .bind(LATEST)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    with_tasks(db, rows).await
}

pub async fn unread_count(db: &PgPool, user_id: i32) -> async_graphql::Result<i32> {
    sqlx::query_scalar("SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL")
        .bind(user_id)
        .fetch_one(db)
        .await
        .map_err(internal)
}

/// Marks one of your notifications read (one read already keeps the time it was first read)
pub async fn mark_read(db: &PgPool, id: i32, user_id: i32) -> async_graphql::Result<Notification> {
    // COALESCE: a read_at that's already there stays as it is
    let row: Row = sqlx::query_as(
        "UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2
         RETURNING id, task_id, kind, message, created_at, read_at",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(internal)?
    .ok_or_else(|| not_found(&format!("Notification {id} not found")))?; // someone else's too
    let mut notifications = with_tasks(db, vec![row]).await?;
    Ok(notifications.remove(0))
}

/// Gives back how many were marked
pub async fn mark_all_read(db: &PgPool, user_id: i32) -> async_graphql::Result<i32> {
    let marked = sqlx::query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL")
        .bind(user_id)
        .execute(db)
        .await
        .map_err(internal)?;
    Ok(marked.rows_affected() as i32)
}

/// The rows as notifications, with their tasks, from one more query for all of them together
async fn with_tasks(db: &PgPool, rows: Vec<Row>) -> async_graphql::Result<Vec<Notification>> {
    // filter_map: the task ids, skipping the notifications without a task
    let ids: Vec<i32> = rows.iter().filter_map(|row| row.task_id).collect();
    let tasks: HashMap<i32, Task> = tasks::find_many(db, &ids)
        .await?
        .into_iter()
        .map(|task| (task.id, task))
        .collect();

    Ok(rows
        .into_iter()
        .map(|row| Notification {
            id: row.id,
            // cloned: a copy of the task for each notification (several can be about the same task)
            task: row.task_id.and_then(|id| tasks.get(&id).cloned()),
            task_id: row.task_id,
            kind: row.kind,
            message: row.message,
            created_at: row.created_at,
            read_at: row.read_at,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cut_like_javascript_slice() {
        assert_eq!(cut_to_units("short", 200), "short");
        assert_eq!(cut_to_units(&"é".repeat(201), 200), "é".repeat(200)); // é: one unit
        assert_eq!(cut_to_units(&"😀".repeat(101), 200), "😀".repeat(100)); // 😀: two
        // 199 units, then an emoji: only its first half fits
        assert_eq!(
            cut_to_units(&format!("{}😀", "x".repeat(199)), 200),
            format!("{}\u{FFFD}", "x".repeat(199))
        );
    }
}
