//! What YOU do with Claude's work in the task panel (prompt-review.service.ts in NestJS): edit the prompt, approve
//! it, or ask for changes; later, ask for a build to be merged, or the runner to try again. Approving is the only
//! way a task gets built: it copies the prompt into approved_prompt, the exact text the runner will carry out.
//!
//! First the checks, each with NestJS's message. Then, as in jobs.rs, the change re-checks its condition in its
//! own UPDATE: if the task changed after the checks (e.g. in another tab, or by the runner), nothing is changed
//! and you get the same refusal as if it had been like that from the start.

use std::sync::LazyLock;

use regex::Regex;
use sqlx::PgPool;
use sqlx::postgres::PgQueryResult;

use super::jobs::move_to_bottom;
use crate::comments::{self, Comment};
use crate::errors::{bad_request, internal};
use crate::tasks::{self, Task, TaskStatus};
use crate::validate::JS_SPACES;

/// SQL: the task's prompt is waiting for your review: in Prompt Review, with a prompt. (`<> ''` is false for NULL
/// too, so it's "there and not empty", NestJS's `!task.refinedPrompt`.)
const IN_REVIEW: &str = "status = 'prompt_review' AND refined_prompt <> ''";

/// The blanks Claude leaves for you in a prompt, e.g. "[[FILL IN: which page should this go on?]]"
fn has_blanks(prompt: &str) -> bool {
    static BLANK: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"\[\[[{JS_SPACES}]*(?i:FILL IN)")).unwrap());
    BLANK.is_match(prompt)
}

fn no_prompt_to_review() -> async_graphql::Error {
    bad_request("This task has no prompt waiting for your review")
}

/// Ok when the UPDATE changed the task; otherwise `refusal`: the task changed after the checks
fn changed(result: PgQueryResult, refusal: fn() -> async_graphql::Error) -> async_graphql::Result<()> {
    if result.rows_affected() == 0 {
        Err(refusal())
    } else {
        Ok(())
    }
}

/// The task, if its prompt is waiting for your review. Someone else's task: "Task 7 not found".
async fn waiting_for_review(db: &PgPool, task_id: i32, owner_id: i32) -> async_graphql::Result<Task> {
    let task = tasks::find_owned(db, task_id, owner_id).await?;
    let has_prompt = task.refined_prompt.as_deref().is_some_and(|prompt| !prompt.is_empty());
    if task.status != TaskStatus::PromptReview || !has_prompt {
        return Err(no_prompt_to_review());
    }
    Ok(task)
}

/// Your edits. Editing cancels any earlier approval: only the text you approve last gets built.
pub async fn edit_prompt(db: &PgPool, task_id: i32, owner_id: i32, prompt: &str) -> async_graphql::Result<Task> {
    waiting_for_review(db, task_id, owner_id).await?;
    let result = sqlx::query(&format!(
        "UPDATE tasks SET refined_prompt = $2, approved_prompt = NULL, prompt_approved_at = NULL
         WHERE id = $1 AND {IN_REVIEW}"
    ))
    .bind(task_id)
    .bind(prompt)
    .execute(db)
    .await
    .map_err(internal)?;
    changed(result, no_prompt_to_review)?;
    tasks::find_owned(db, task_id, owner_id).await
}

/// Approve: the prompt is locked in, and the task moves to In progress, where the runner picks it up
pub async fn approve(db: &PgPool, task_id: i32, owner_id: i32) -> async_graphql::Result<Task> {
    let task = waiting_for_review(db, task_id, owner_id).await?;
    if task.changes_requested {
        return Err(bad_request("Claude is still revising this prompt"));
    }
    let prompt = task.refined_prompt.unwrap_or_default();
    if has_blanks(&prompt) {
        return Err(bad_request("Fill in the [[FILL IN: …]] blanks in the prompt first"));
    }

    // approved_prompt = $2: exactly the text checked above, and only while it's still the task's prompt
    let result = sqlx::query(&format!(
        "UPDATE tasks SET approved_prompt = $2, prompt_approved_at = now(), ai_error = NULL
         WHERE id = $1 AND {IN_REVIEW} AND refined_prompt = $2 AND changes_requested = false"
    ))
    .bind(task_id)
    .bind(&prompt)
    .execute(db)
    .await
    .map_err(internal)?;
    changed(result, no_prompt_to_review)?;
    move_to_bottom(db, task_id, owner_id, TaskStatus::InProgress).await
}

/// Request changes: your comment goes on the task (a "feedback" comment, shown in the AI tab), and Claude revises
/// the prompt on its next run. The task stays in Prompt Review, with "Revising…" on its card.
pub async fn request_changes(db: &PgPool, task_id: i32, owner_id: i32, comment: &str) -> async_graphql::Result<Task> {
    waiting_for_review(db, task_id, owner_id).await?;

    // Both or neither: the feedback, and the flag that has the runner pick the task up again
    let mut transaction = db.begin().await.map_err(internal)?;
    comments::add_feedback(&mut *transaction, task_id, owner_id, comment)
        .await
        .map_err(internal)?;
    let result = sqlx::query(&format!(
        "UPDATE tasks SET changes_requested = true, ai_error = NULL WHERE id = $1 AND {IN_REVIEW}"
    ))
    .bind(task_id)
    .execute(&mut *transaction)
    .await
    .map_err(internal)?;
    // Refused: returning here drops the transaction without committing it, which undoes the feedback
    changed(result, no_prompt_to_review)?;
    transaction.commit().await.map_err(internal)?;
    tasks::find_owned(db, task_id, owner_id).await
}

/// Your feedback on Claude's prompts, and Claude's notes from before it had its own log, oldest first (the AI
/// tab; they're not under Comments)
pub async fn ai_notes(db: &PgPool, task_id: i32, owner_id: i32) -> async_graphql::Result<Vec<Comment>> {
    tasks::find_owned(db, task_id, owner_id).await?;
    comments::of_task(db, task_id, Some(&["feedback", "claude"])).await
}

fn not_built() -> async_graphql::Error {
    bad_request("Only a built task in AI Review can be merged")
}

/// Merge, after you've checked a build in AI Review: the runner merges the branch on its next check (it has git;
/// the board doesn't). Only a build that went fine: Claude finished and the checks passed.
pub async fn request_merge(db: &PgPool, task_id: i32, owner_id: i32) -> async_graphql::Result<Task> {
    let task = tasks::find_owned(db, task_id, owner_id).await?;
    if task.status != TaskStatus::AiReview || task.ai_branch.is_none() || task.ai_built_at.is_none() {
        return Err(not_built());
    }
    if task.ai_checks_passed != Some(true) {
        return Err(bad_request(
            "This build's checks didn't pass: merge it by hand if you still want it",
        ));
    }
    if task.ai_merged_at.is_some() {
        return Err(bad_request("This branch is already merged"));
    }

    let result = sqlx::query(
        "UPDATE tasks SET ai_merge_requested_at = now(), ai_error = NULL
         WHERE id = $1 AND status = 'ai_review' AND ai_branch IS NOT NULL AND ai_built_at IS NOT NULL
           AND ai_checks_passed = true AND ai_merged_at IS NULL",
    )
    .bind(task_id)
    .execute(db)
    .await
    .map_err(internal)?;
    changed(result, not_built)?;
    tasks::find_owned(db, task_id, owner_id).await
}

/// "Try again" after the runner stopped on a task: it's picked up again on its next check
pub async fn retry(db: &PgPool, task_id: i32, owner_id: i32) -> async_graphql::Result<Task> {
    tasks::find_owned(db, task_id, owner_id).await?;
    sqlx::query("UPDATE tasks SET ai_error = NULL WHERE id = $1")
        .bind(task_id)
        .execute(db)
        .await
        .map_err(internal)?;
    tasks::find_owned(db, task_id, owner_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blanks_like_nestjs() {
        assert!(has_blanks("Add a search box. [[FILL IN: which page?]]"));
        assert!(has_blanks("[[  fill in the colour]]"));
        assert!(has_blanks("[[\u{A0}Fill In]]")); // JavaScript's \s has the no-break space
        assert!(!has_blanks("Add a search box to the board page."));
        assert!(!has_blanks("[ [FILL IN]]"));
        assert!(!has_blanks("[[FILLIN]]"));
    }
}
