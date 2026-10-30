//! The assistant's tools: what Claude may do on the board (task-tools.ts, ai-tools.ts and detail-tools.ts in NestJS).
//!   task_tools.rs    create_task, update_task, move_task
//!   ai_tools.rs      get_ai_details, approve_prompt, request_prompt_changes (the Claude runner's work)
//!   detail_tools.rs  change_task_labels, create_label, update_label, add_checklist_items, update_checklist_item
//!   input.rs         reading a tool's input with the same rules and messages as NestJS's (Zod)
//!
//! `Tools` is made fresh for ONE user and ONE board on every chat message: the user from the login cookie, the
//! board from the screen. Neither is a tool input, so Claude can only reach this user's tasks on this board. And
//! nothing here deletes: deleting stays with the user.
//!
//! A tool gives back the text Claude reads ("Created task #12 ..."), or an error, which Claude reads as
//! "Error: ..." (and may then try something else, or tell the user).

mod ai_tools;
mod detail_tools;
mod input;
mod task_tools;

use std::sync::LazyLock;

use async_graphql::MaybeUndefined;
use serde_json::{Value, json};
use sqlx::PgPool;

use crate::tasks::{self, Task};

/// What a tool gives back: the text for Claude, or its error
type Outcome = Result<String, String>;

/// The tools' definitions as Claude is sent them: names, descriptions and input rules (JSON Schema). Taken from
/// what NestJS sends (Zod's schemas, turned into JSON Schema by the SDK), so Claude sees the same tools.
pub fn definitions() -> &'static Value {
    static DEFINITIONS: LazyLock<Value> =
        LazyLock::new(|| serde_json::from_str(include_str!("definitions.json")).expect("definitions.json is JSON"));
    &DEFINITIONS
}

/// The tools, for one user's chat message about one of their boards
pub struct Tools<'a> {
    pub db: &'a PgPool,
    pub owner_id: i32,
    pub board_id: i32,
}

impl Tools<'_> {
    /// Runs one tool. A name Claude made up gets the SDK's "Tool '...' not found".
    async fn run(&self, name: &str, input: &Value) -> Outcome {
        match name {
            "create_task" => task_tools::create_task(self, input).await,
            "update_task" => task_tools::update_task(self, input).await,
            "move_task" => task_tools::move_task(self, input).await,
            "get_ai_details" => ai_tools::get_ai_details(self, input).await,
            "approve_prompt" => ai_tools::approve_prompt(self, input).await,
            "request_prompt_changes" => ai_tools::request_prompt_changes(self, input).await,
            "change_task_labels" => detail_tools::change_task_labels(self, input).await,
            "create_label" => detail_tools::create_label(self, input).await,
            "update_label" => detail_tools::update_label(self, input).await,
            "add_checklist_items" => detail_tools::add_checklist_items(self, input).await,
            "update_checklist_item" => detail_tools::update_checklist_item(self, input).await,
            _ => Err(format!("Tool '{name}' not found")),
        }
    }

    /// One of your tasks, on this board. A task from another board looks like one that doesn't exist.
    async fn on_this_board(&self, id: i64) -> Result<Task, String> {
        let Ok(id) = i32::try_from(id) else {
            return Err(format!("Task {id} not found"));
        };
        let task = tasks::find_owned(self.db, id, self.owner_id).await.map_err(message)?;
        if task.board_id != self.board_id {
            return Err(format!("Task {id} not found on this board"));
        }
        Ok(task)
    }
}

/// A field to change, for the services' update inputs: Some = change it to this, None = leave it as it is
fn change<T>(value: Option<T>) -> MaybeUndefined<T> {
    value.map_or(MaybeUndefined::Undefined, MaybeUndefined::Value)
}

/// What a tool tells Claude when something it called refused: the error's message ("Task 7 not found")
fn message(error: async_graphql::Error) -> String {
    error.message
}

/// Runs the tools Claude asked for in one answer (its tool_use blocks), one after another, and gives back their
/// results, for the next request. None when it asked for none.
pub async fn run_calls(tools: &Tools<'_>, content: &[Value]) -> Option<Vec<Value>> {
    let calls: Vec<&Value> = content.iter().filter(|block| block["type"] == "tool_use").collect();
    if calls.is_empty() {
        return None;
    }
    let mut results = Vec::with_capacity(calls.len());
    for call in calls {
        let name = call["name"].as_str().unwrap_or_default();
        // Each result says which call it answers (tool_use_id), as the SDK writes it
        results.push(match tools.run(name, &call["input"]).await {
            Ok(text) => json!({ "type": "tool_result", "tool_use_id": call["id"], "content": text }),
            Err(error) => json!({
                "type": "tool_result", "tool_use_id": call["id"], "content": format!("Error: {error}"), "is_error": true
            }),
        });
    }
    Some(results)
}
