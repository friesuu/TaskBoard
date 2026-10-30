//! The work on comments (comments.service.ts in NestJS): plain functions that take the database, the inputs
//! (already checked) and who's asking. No GraphQL in here.

use sqlx::{PgExecutor, PgPool};

use super::types::Comment;
use crate::errors::{bad_request, internal, not_found};
use crate::scalars::DateTime;
use crate::tasks;
use crate::users::User;

/// One row of the query below: a comment and its author, side by side (`author_...`)
#[derive(sqlx::FromRow)]
struct Row {
    id: i32,
    body: String,
    created_at: DateTime,
    updated_at: DateTime,
    task_id: i32,
    kind: String,
    author_id: i32,
    author_email: String,
    author_time_zone: Option<String>,
    author_display_name: Option<String>,
    author_token_version: i32,
}

/// The columns that fill a Row, with the author joined in (NestJS's relations: { author: true })
const COMMENT_COLUMNS: &str = "comments.id, comments.body, comments.created_at, comments.updated_at,
    comments.task_id, comments.kind, users.id AS author_id, users.email AS author_email,
    users.time_zone AS author_time_zone, users.display_name AS author_display_name,
    users.token_version AS author_token_version
    FROM comments JOIN users ON users.id = comments.author_id";

// `From`: how a Row becomes a Comment, so `Comment::from(row)` (or `row.into()`) does it
impl From<Row> for Comment {
    fn from(row: Row) -> Comment {
        Comment {
            id: row.id,
            body: row.body,
            created_at: row.created_at,
            updated_at: row.updated_at,
            task_id: row.task_id,
            author: User {
                id: row.author_id,
                email: row.author_email,
                time_zone: row.author_time_zone,
                display_name: row.author_display_name,
                token_version: row.author_token_version,
            },
            from_runner: row.kind == "claude",
            kind: row.kind,
        }
    }
}

/// A task's comments, oldest first (the newest at the bottom, like a chat), each with its author. Only real
/// comments: Claude's notes and your prompt feedback are in the AI tab.
pub async fn find_all(db: &PgPool, task_id: i32, user_id: i32) -> async_graphql::Result<Vec<Comment>> {
    tasks::find_owned(db, task_id, user_id).await?;
    let rows: Vec<Row> = sqlx::query_as(&format!(
        "SELECT {COMMENT_COLUMNS} WHERE comments.task_id = $1 AND comments.kind = 'comment'
         ORDER BY comments.created_at, comments.id"
    ))
    .bind(task_id)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    // into_iter().map(...).collect(): each row into a Comment, all of them into a Vec again
    Ok(rows.into_iter().map(Comment::from).collect())
}

/// A task's comments of these kinds (None: every kind), oldest first, each with its author: what the runner
/// reads with a job (every kind), and the AI tab (feedback and claude). The caller has checked whose task it is.
pub async fn of_task(db: &PgPool, task_id: i32, kinds: Option<&[&str]>) -> async_graphql::Result<Vec<Comment>> {
    // `$2::text[] IS NULL OR ...`: no list means no filter
    let rows: Vec<Row> = sqlx::query_as(&format!(
        "SELECT {COMMENT_COLUMNS} WHERE comments.task_id = $1 AND ($2::text[] IS NULL OR comments.kind = ANY($2))
         ORDER BY comments.created_at, comments.id"
    ))
    .bind(task_id)
    .bind(kinds)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    Ok(rows.into_iter().map(Comment::from).collect())
}

/// Your feedback on Claude's prompt ("Request changes"): a comment of kind "feedback", shown in the AI tab.
/// `db` can be a transaction (PgExecutor), so it's saved together with the task's change, or not at all.
pub async fn add_feedback(
    db: impl PgExecutor<'_>,
    task_id: i32,
    author_id: i32,
    body: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO comments (task_id, author_id, body, kind) VALUES ($1, $2, $3, 'feedback')")
        .bind(task_id)
        .bind(author_id)
        .bind(body)
        .execute(db)
        .await?;
    Ok(())
}

/// A new comment (`body` is already trimmed and checked)
pub async fn add(db: &PgPool, task_id: i32, user_id: i32, body: &str) -> async_graphql::Result<Comment> {
    tasks::find_owned(db, task_id, user_id).await?;
    let id: i32 =
        sqlx::query_scalar("INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id")
            .bind(task_id)
            .bind(user_id)
            .bind(body)
            .fetch_one(db)
            .await
            .map_err(internal)?;
    find_yours(db, id, user_id).await // read again, with its author
}

/// A new text for one of your comments. Only real comments can be edited, not Claude's or prompt feedback.
pub async fn update(db: &PgPool, id: i32, user_id: i32, body: &str) -> async_graphql::Result<Comment> {
    let comment = find_yours(db, id, user_id).await?;
    if comment.kind == "claude" {
        return Err(bad_request("Claude's comments can't be edited"));
    }
    if comment.kind != "comment" {
        return Err(bad_request("Prompt feedback can't be edited"));
    }
    // The same text: nothing is saved, so it doesn't show as edited (NestJS's TypeORM skips the save too)
    if comment.body == body {
        return Ok(comment);
    }
    sqlx::query("UPDATE comments SET body = $2, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(body)
        .execute(db)
        .await
        .map_err(internal)?;
    find_yours(db, id, user_id).await
}

/// Only your own real comments can be deleted; anything else is "Comment 7 not found"
pub async fn remove(db: &PgPool, id: i32, user_id: i32) -> async_graphql::Result<()> {
    let deleted = sqlx::query("DELETE FROM comments WHERE id = $1 AND author_id = $2 AND kind = 'comment'")
        .bind(id)
        .bind(user_id)
        .execute(db)
        .await
        .map_err(internal)?;
    if deleted.rows_affected() == 0 {
        return Err(comment_not_found(id));
    }
    Ok(())
}

/// A comment YOU wrote. Anyone else's comment looks exactly like one that doesn't exist.
async fn find_yours(db: &PgPool, id: i32, user_id: i32) -> async_graphql::Result<Comment> {
    let row: Row = sqlx::query_as(&format!(
        "SELECT {COMMENT_COLUMNS} WHERE comments.id = $1 AND comments.author_id = $2"
    ))
    .bind(id)
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(internal)?
    .ok_or_else(|| comment_not_found(id))?;
    Ok(row.into())
}

fn comment_not_found(id: i32) -> async_graphql::Error {
    not_found(&format!("Comment {id} not found"))
}
