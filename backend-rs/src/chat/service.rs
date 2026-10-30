//! The chat's work (chat.service.ts in NestJS): plain functions that take the database and whose chat it is. No
//! GraphQL in here.

use std::time::Instant;

use serde_json::{Value, json};
use sqlx::PgPool;

use super::claude::Claude;
use super::context::{describe_labels, describe_tasks};
use super::tools::Tools;
use super::types::ChatMessage;
use crate::errors::internal;
use crate::{boards, checklist, labels, tasks};

/// How many earlier messages Claude "remembers"
const MEMORY_SIZE: i64 = 20;

const MESSAGE_COLUMNS: &str = "id, role, content, created_at, response_ms";

/// Your whole conversation, oldest first (for the screen)
pub async fn history(db: &PgPool, owner_id: i32) -> async_graphql::Result<Vec<ChatMessage>> {
    sqlx::query_as(&format!(
        "SELECT {MESSAGE_COLUMNS} FROM chat_messages WHERE owner_id = $1 ORDER BY id"
    ))
    .bind(owner_id)
    .fetch_all(db)
    .await
    .map_err(internal)
}

/// Your message (`text`, already trimmed and checked) about one of your boards, and Claude's answer. Gives back
/// the answer, saved.
pub async fn send(
    db: &PgPool,
    claude: &Claude,
    owner_id: i32,
    board_id: i32,
    text: &str,
) -> async_graphql::Result<ChatMessage> {
    let board = boards::find_owned(db, board_id, owner_id).await?; // "not found" if it isn't yours

    // 1. Memory: the last MEMORY_SIZE messages, oldest first
    let mut memory: Vec<(String, String)> =
        sqlx::query_as("SELECT role, content FROM chat_messages WHERE owner_id = $1 ORDER BY id DESC LIMIT $2")
            .bind(owner_id)
            .bind(MEMORY_SIZE)
            .fetch_all(db)
            .await
            .map_err(internal)?;
    memory.reverse();
    // Claude needs the conversation to start with a user message: Claude's answers before your first one go
    let yours = memory
        .iter()
        .position(|(role, _)| role == "user")
        .unwrap_or(memory.len());
    memory.drain(..yours);

    // 2. Context: this board as it is now (sent with this message only, never saved)
    let tasks = tasks::find_all(db, owner_id, board_id, tasks::TaskFilterInput::default(), None).await?;
    let task_ids: Vec<i32> = tasks.iter().map(|task| task.id).collect();
    let labels = labels::find_all(db, board_id).await.map_err(internal)?;
    let items = checklist::of_tasks(db, &task_ids).await?;
    // Today in the server's own time zone, YYYY-MM-DD (as NestJS's toLocaleDateString('en-CA'))
    let today = chrono::Local::now().format("%Y-%m-%d");
    let context = format!(
        "<my_tasks>\nToday is {today}. Board: \"{}\".\n{}\n{}\n</my_tasks>\n\n",
        board.name,
        describe_labels(&labels),
        describe_tasks(&tasks, &items)
    );

    // 3. Ask Claude: memory + the new message, timed so the chat can show how long the answer took
    let mut messages: Vec<Value> = memory
        .into_iter()
        .map(|(role, content)| json!({ "role": role, "content": content }))
        .collect();
    messages.push(json!({ "role": "user", "content": format!("{context}{text}") }));
    let started = Instant::now();
    let tools = Tools { db, owner_id, board_id }; // for THIS user and THIS board only
    let answer = claude.reply(messages, &tools).await?;
    // In milliseconds, tool steps included (e.g. creating tasks)
    let response_ms = i32::try_from(started.elapsed().as_millis()).unwrap_or(i32::MAX);

    // 4. Both saved only now, together, so a failed request leaves no half-finished turn behind
    let saved: Vec<ChatMessage> = sqlx::query_as(&format!(
        "INSERT INTO chat_messages (owner_id, role, content, response_ms)
         VALUES ($1, 'user', $2, NULL), ($1, 'assistant', $3, $4) RETURNING {MESSAGE_COLUMNS}"
    ))
    .bind(owner_id)
    .bind(text)
    .bind(answer)
    .bind(response_ms)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    saved
        .into_iter()
        .find(|message| message.role == "assistant")
        .ok_or_else(|| internal("the answer wasn't saved"))
}

/// Forgets your whole conversation
pub async fn clear(db: &PgPool, owner_id: i32) -> async_graphql::Result<()> {
    sqlx::query("DELETE FROM chat_messages WHERE owner_id = $1")
        .bind(owner_id)
        .execute(db)
        .await
        .map_err(internal)?;
    Ok(())
}
