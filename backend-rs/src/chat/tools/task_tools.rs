//! Creating, editing and moving tasks (task-tools.ts in NestJS). These call the tasks service directly, so the
//! GraphQL input rules don't run: the rules here (input.rs) are the checking.

use async_graphql::MaybeUndefined;
use serde_json::Value;

use super::input::{Input, Text};
use super::{Outcome, Tools, change, message};
use crate::tasks::{self, CreateTaskInput, MoveTaskInput, TaskStatus, UpdateTaskInput};

/// The columns Claude may put a task in: the same names it sees in <my_tasks>. (Prompt Review and AI Review are
/// the Claude runner's.)
const STATUSES: &[&str] = &["todo", "in_progress", "done"];

const TITLE: Text = Text {
    trim: true,
    min: Some(1),
    max: Some(100),
    date: false,
};
const DESCRIPTION: Text = Text {
    trim: false,
    min: None,
    max: Some(10000),
    date: false,
};
const DUE_DATE: Text = Text {
    trim: false,
    min: None,
    max: None,
    date: true,
};

/// A task past the end of any column: moving it there puts it at the bottom
const BOTTOM: i64 = 1_000_000;

fn status_named(name: &str) -> TaskStatus {
    match name {
        "in_progress" => TaskStatus::InProgress,
        "done" => TaskStatus::Done,
        _ => TaskStatus::Todo,
    }
}

/// A new task, at the bottom of its column
pub async fn create_task(tools: &Tools<'_>, input: &Value) -> Outcome {
    let mut input = Input::new(input)?;
    let title = input.text("title", TITLE);
    let description = input.optional_text("description", DESCRIPTION);
    let due_date = input.optional_text("dueDate", DUE_DATE);
    let status = input.optional_one_of("status", STATUSES);
    input.done()?;

    let new_task = CreateTaskInput {
        board_id: tools.board_id,
        title: title.unwrap_or_default(),
        description,
        status: change(status.map(|status| status_named(&status))), // left out: To do
        due_date,
    };
    let task = tasks::create(tools.db, new_task, tools.owner_id)
        .await
        .map_err(message)?;
    Ok(format!(
        "Created task #{} \"{}\" in {}.",
        task.id,
        task.title,
        task.status.as_str()
    ))
}

/// A new title, description or due date (null removes the due date, as the app's own "No due date" does)
pub async fn update_task(tools: &Tools<'_>, input: &Value) -> Outcome {
    let mut input = Input::new(input)?;
    let id = input.int("id");
    let title = input.optional_text("title", TITLE);
    let description = input.optional_text("description", DESCRIPTION);
    let due_date = input.nullable_text("dueDate", DUE_DATE);
    input.done()?;

    let task = tools.on_this_board(id.unwrap_or_default()).await?;
    let changes = UpdateTaskInput {
        title: change(title),
        description: change(description),
        status: MaybeUndefined::Undefined,
        due_date,
    };
    let task = tasks::update(tools.db, task.id, changes, tools.owner_id)
        .await
        .map_err(message)?;
    Ok(format!("Updated task #{} \"{}\".", task.id, task.title))
}

/// To another column (or another place in its own): 0 is the top, none the bottom
pub async fn move_task(tools: &Tools<'_>, input: &Value) -> Outcome {
    let mut input = Input::new(input)?;
    let id = input.int("id");
    let status = input.one_of("status", STATUSES);
    let position = input.optional_int("position", 0);
    input.done()?;

    let task = tools.on_this_board(id.unwrap_or_default()).await?;
    let to = MoveTaskInput {
        status: status_named(&status.unwrap_or_default()),
        // A number past the end means "at the bottom" (move_to handles that)
        position: i32::try_from(position.unwrap_or(BOTTOM)).unwrap_or(i32::MAX),
    };
    let task = tasks::move_to(tools.db, task.id, to, tools.owner_id)
        .await
        .map_err(message)?;
    Ok(format!(
        "Moved task #{} \"{}\" to {}.",
        task.id,
        task.title,
        task.status.as_str()
    ))
}
