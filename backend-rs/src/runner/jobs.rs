//! The runner's side of the Claude workflow (runner.service.ts in NestJS): the next job, and each step. Every step
//! checks, here on the server, that the task really is waiting for that step, so the runner can never build a
//! prompt you haven't approved, even if it tried.
//!
//! The check and the change are one statement: `UPDATE tasks SET <the step's changes> WHERE <the task is waiting
//! for this step>`. When it changes no row, the task wasn't waiting (or isn't any more), and the step is refused.
//! NestJS reads the task, checks it, then writes: in between, another request could change the task (a second
//! runner taking the same job, or you dragging the task to another column), and the write would go through
//! anyway. One UPDATE leaves no "in between": PostgreSQL locks the row, and checks the WHERE again on the row as
//! it is then.

use sqlx::PgPool;

use super::types::{RunnerJob, RunnerJobKind};
use crate::errors::{bad_request, internal};
use crate::tasks::{self, MoveTaskInput, Task, TaskStatus};
use crate::{boards, checklist, comments, notifications};

/// A spot past the end of any column: moving there puts the task at the bottom
const BOTTOM: i32 = 1_000_000;

/// SQL: your tasks the runner may touch at all, whatever the step ($1: you). Only tasks with a label called "ai"
/// (any capitals: "AI", "ai"), on a board with a project, and not stopped by an error (until you click "Try again").
const RUNNER_TASKS: &str = "tasks.owner_id = $1
    AND tasks.ai_error IS NULL
    AND EXISTS (SELECT 1 FROM boards WHERE boards.id = tasks.board_id AND boards.project IS NOT NULL)
    AND EXISTS (SELECT 1 FROM task_labels link JOIN labels ON labels.id = link.label_id
                WHERE link.task_id = tasks.id AND LOWER(labels.name) = 'ai')";

/// SQL: what makes a task wait for this step, and the order the waiting ones are taken in. The same conditions
/// pick the next job and allow (or refuse) the step itself.
fn waiting(kind: RunnerJobKind) -> (&'static str, &'static str) {
    match kind {
        // A build that went fine, in AI Review, that you clicked Merge on, not merged yet. Oldest click first.
        RunnerJobKind::Merge => (
            "tasks.status = 'ai_review' AND tasks.ai_branch IS NOT NULL AND tasks.ai_built_at IS NOT NULL
             AND tasks.ai_checks_passed = true AND tasks.ai_merge_requested_at IS NOT NULL AND tasks.ai_merged_at IS NULL",
            "tasks.ai_merge_requested_at, tasks.id",
        ),
        // Approved and in In progress: not started yet, or built before and moved back to In progress (then it's
        // built again, from scratch on a new branch). Never while a build is running: a branch, not built yet.
        // Oldest approval first.
        RunnerJobKind::Build => (
            "tasks.status = 'in_progress' AND tasks.approved_prompt IS NOT NULL
             AND (tasks.ai_branch IS NULL OR tasks.ai_built_at IS NOT NULL)",
            "tasks.prompt_approved_at, tasks.id",
        ),
        // A new task in To do with no prompt yet, or a prompt you asked Claude to change. Oldest task first.
        RunnerJobKind::Refine => (
            "((tasks.status = 'todo' AND tasks.refined_prompt IS NULL)
              OR (tasks.status = 'prompt_review' AND tasks.changes_requested = true))",
            "tasks.created_at, tasks.id",
        ),
    }
}

/// SQL: change one task ($2) with `changes`, but only if it's yours ($1) and waiting for this step. Gives back its
/// status, or no row when it wasn't waiting.
fn claim(kind: RunnerJobKind, changes: &str) -> String {
    let (condition, _) = waiting(kind);
    format!("UPDATE tasks SET {changes} WHERE tasks.id = $2 AND {RUNNER_TASKS} AND {condition} RETURNING tasks.status")
}

fn not_waiting(task_id: i32) -> async_graphql::Error {
    bad_request(&format!("Task {task_id} isn't waiting for this step"))
}

/// The next thing to do, one task at a time: first a merge you asked for (quick, and no Claude), then anything
/// approved and waiting to be built, then a prompt to write or revise. None: nothing to do.
/// `kinds`: the jobs this runner can do. An older runner doesn't know MERGE, so it's never handed one.
pub async fn next_job(db: &PgPool, owner_id: i32, kinds: &[RunnerJobKind]) -> async_graphql::Result<Option<RunnerJob>> {
    for kind in [RunnerJobKind::Merge, RunnerJobKind::Build, RunnerJobKind::Refine] {
        if !kinds.contains(&kind) {
            continue;
        }
        let (condition, order) = waiting(kind);
        let next: Option<(i32, Option<String>)> = sqlx::query_as(&format!(
            "SELECT tasks.id, tasks.approved_prompt FROM tasks WHERE {RUNNER_TASKS} AND {condition}
             ORDER BY {order} LIMIT 1"
        ))
        .bind(owner_id)
        .fetch_optional(db)
        .await
        .map_err(internal)?;
        if let Some((task_id, approved_prompt)) = next {
            return job_for(db, task_id, owner_id, kind, approved_prompt).await.map(Some);
        }
    }
    Ok(None)
}

/// Everything the runner needs to read for one job
async fn job_for(
    db: &PgPool,
    task_id: i32,
    owner_id: i32,
    kind: RunnerJobKind,
    approved_prompt: Option<String>,
) -> async_graphql::Result<RunnerJob> {
    let task = tasks::find_owned(db, task_id, owner_id).await?;
    let board = boards::find_owned(db, task.board_id, owner_id).await?;
    // try_join!: both queries at the same time, and the first error if either fails (Promise.all in NestJS)
    let (comments, checklist) =
        tokio::try_join!(comments::of_task(db, task_id, None), checklist::in_order(db, task_id))?;
    Ok(RunnerJob {
        kind,
        // The task was picked because its board has a project; it's only missing if it was removed just now
        project: board
            .project
            .ok_or_else(|| internal("the board's project was removed"))?,
        task,
        approved_prompt: if kind == RunnerJobKind::Build {
            approved_prompt
        } else {
            None
        },
        comments,
        checklist,
    })
}

/// The prompt Claude wrote, or revised. A new one moves the task to Prompt Review (a revision is already there).
/// Either way it waits for your approval again: any earlier approval is gone.
pub async fn save_prompt(db: &PgPool, task_id: i32, owner_id: i32, prompt: &str) -> async_graphql::Result<Task> {
    let status: Option<TaskStatus> = sqlx::query_scalar(&claim(
        RunnerJobKind::Refine,
        "refined_prompt = $3, changes_requested = false, approved_prompt = NULL, prompt_approved_at = NULL",
    ))
    .bind(owner_id)
    .bind(task_id)
    .bind(prompt)
    .fetch_optional(db)
    .await
    .map_err(internal)?;
    let Some(status) = status else {
        return Err(not_waiting(task_id));
    };

    let is_revision = status == TaskStatus::PromptReview;
    if !is_revision {
        move_to_bottom(db, task_id, owner_id, TaskStatus::PromptReview).await?;
    }
    let message = if is_revision {
        "Revised prompt ready for approval"
    } else {
        "Prompt ready for approval"
    };
    notifications::notify(db, owner_id, "prompt_ready", message, Some(task_id)).await?;
    tasks::find_owned(db, task_id, owner_id).await
}

/// The runner made the task's branch and is about to build. Setting the branch (and no build time) is what stops
/// the task being picked again while it builds.
pub async fn start_build(db: &PgPool, task_id: i32, owner_id: i32, branch: &str) -> async_graphql::Result<Task> {
    let claimed: Option<TaskStatus> = sqlx::query_scalar(&claim(
        RunnerJobKind::Build,
        "ai_branch = $3, ai_built_at = NULL, ai_checks_passed = NULL, ai_merge_requested_at = NULL, ai_merged_at = NULL",
    ))
    .bind(owner_id)
    .bind(task_id)
    .bind(branch)
    .fetch_optional(db)
    .await
    .map_err(internal)?;
    if claimed.is_none() {
        return Err(not_waiting(task_id));
    }
    tasks::find_owned(db, task_id, owner_id).await
}

/// The build is done, whether or not it went fine: the task moves to AI Review, for you to look at. Only for a
/// build that's running: started (a branch), and not finished yet.
/// `checks_passed`: false when Claude stopped early or the runner's checks failed; the task then shows as Failed.
/// (The summary is on the run: activity.rs.)
pub async fn finish_build(
    db: &PgPool,
    task_id: i32,
    owner_id: i32,
    checks_passed: bool,
) -> async_graphql::Result<Task> {
    tasks::find_owned(db, task_id, owner_id).await?; // someone else's task: "Task 7 not found"
    let built = sqlx::query(
        "UPDATE tasks SET ai_built_at = now(), ai_checks_passed = $3
         WHERE id = $2 AND owner_id = $1 AND status = 'in_progress' AND ai_branch IS NOT NULL AND ai_built_at IS NULL",
    )
    .bind(owner_id)
    .bind(task_id)
    .bind(checks_passed)
    .execute(db)
    .await
    .map_err(internal)?;
    if built.rows_affected() == 0 {
        return Err(bad_request(&format!("Task {task_id} isn't being built")));
    }

    let (kind, message) = if checks_passed {
        ("review_ready", "Ready for review")
    } else {
        (
            "run_failed",
            "Built, but it needs a look: the checks failed or Claude stopped early",
        )
    };
    notifications::notify(db, owner_id, kind, message, Some(task_id)).await?;
    move_to_bottom(db, task_id, owner_id, TaskStatus::AiReview).await
}

/// The runner merged the branch you clicked Merge on: the work is in the project, so the task is Done
pub async fn finish_merge(db: &PgPool, task_id: i32, owner_id: i32) -> async_graphql::Result<Task> {
    let claimed: Option<TaskStatus> = sqlx::query_scalar(&claim(RunnerJobKind::Merge, "ai_merged_at = now()"))
        .bind(owner_id)
        .bind(task_id)
        .fetch_optional(db)
        .await
        .map_err(internal)?;
    if claimed.is_none() {
        return Err(not_waiting(task_id));
    }
    notifications::notify(db, owner_id, "merged", "Merged into the project", Some(task_id)).await?;
    move_to_bottom(db, task_id, owner_id, TaskStatus::Done).await
}

/// The runner couldn't carry on (e.g. the spend cap was reached). The task stays where it is, and is skipped
/// (RUNNER_TASKS) until you click "Try again" (review.rs).
pub async fn report_error(db: &PgPool, task_id: i32, owner_id: i32, message: &str) -> async_graphql::Result<Task> {
    tasks::find_owned(db, task_id, owner_id).await?;
    sqlx::query("UPDATE tasks SET ai_error = $2 WHERE id = $1")
        .bind(task_id)
        .bind(message)
        .execute(db)
        .await
        .map_err(internal)?;
    notifications::notify(
        db,
        owner_id,
        "run_failed",
        &format!("Claude stopped: {message}"),
        Some(task_id),
    )
    .await?;
    tasks::find_owned(db, task_id, owner_id).await
}

/// Moves a task to the bottom of a column, as if you dragged it there, and gives it back. Also used when you
/// approve a prompt (review.rs).
pub async fn move_to_bottom(
    db: &PgPool,
    task_id: i32,
    owner_id: i32,
    status: TaskStatus,
) -> async_graphql::Result<Task> {
    tasks::move_to(
        db,
        task_id,
        MoveTaskInput {
            status,
            position: BOTTOM,
        },
        owner_id,
    )
    .await
}
