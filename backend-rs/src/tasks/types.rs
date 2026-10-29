//! What the API shows of tasks: task.entity.ts, tasks-status.enum.ts and task-stats.type.ts in NestJS

use async_graphql::{Enum, SimpleObject};

use crate::labels::Label;
use crate::scalars::DateTime;

/// The board's columns, in order (tasks-status.enum.ts). Prompt Review and AI Review belong to the Claude runner.
/// In the database it's tasks_status_enum, written in lowercase with underscores: PromptReview is 'prompt_review'.
#[derive(Enum, sqlx::Type, Clone, Copy, PartialEq, Eq)]
#[sqlx(type_name = "tasks_status_enum", rename_all = "snake_case")]
pub enum TaskStatus {
    Todo,
    PromptReview,
    InProgress,
    AiReview,
    Done,
}

/// A task, as the API shows it (type Task in ../backend/src/schema.gql)
#[derive(SimpleObject, sqlx::FromRow, Clone)]
pub struct Task {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub due_date: Option<String>, // "2026-10-29"
    pub position: i32,
    pub created_at: DateTime,
    // The Claude runner's part, written by the runner's own operations (still in NestJS)
    pub refined_prompt: Option<String>,
    pub changes_requested: bool,
    pub prompt_approved_at: Option<DateTime>,
    pub ai_branch: Option<String>,
    pub ai_built_at: Option<DateTime>,
    pub ai_checks_passed: Option<bool>,
    pub ai_merge_requested_at: Option<DateTime>,
    pub ai_merged_at: Option<DateTime>,
    pub ai_error: Option<String>,
    pub board_id: i32,
    // Counted by the database in the same query (TASK_COLUMNS in service.rs)
    pub checklist_total: i32,
    pub checklist_done: i32,
    pub attachment_count: i32,
    // Not a column: filled after the query, by service::with_labels
    #[sqlx(skip)]
    pub labels: Vec<Label>,
}

/// The profile's numbers, across all of a user's boards
#[derive(SimpleObject, sqlx::FromRow)]
pub struct TaskStats {
    total: i32,
    todo: i32,
    prompt_review: i32,
    in_progress: i32,
    ai_review: i32,
    done: i32,
    overdue: i32,        // due before today and not done
    due_this_week: i32,  // due this week (the user's Monday to Sunday) and not done yet
    done_this_week: i32, // moved into Done this week
}
