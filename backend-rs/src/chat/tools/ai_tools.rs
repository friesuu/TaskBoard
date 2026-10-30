//! The assistant's view of the Claude runner (ai-tools.ts in NestJS): read what it did on a task, and review its
//! prompt (approve / request changes) like the buttons in the task panel.

use serde_json::Value;

use super::input::{Input, Text};
use super::{Outcome, Tools, message};
use crate::{comments, runner};

/// A task's newest runs; older ones rarely matter in a chat
const RUNS_SHOWN: usize = 5;

/// A long prompt or build summary is cut, so one task can't fill Claude's context (in UTF-16 units, as JavaScript
/// counts)
const MAX_TEXT: usize = 4000;

const COMMENT: Text = Text {
    trim: true,
    min: Some(1),
    max: Some(5000),
    date: false,
};

/// What the runner did on up to 5 tasks: one task's trouble ("not found") doesn't stop the others
pub async fn get_ai_details(tools: &Tools<'_>, input: &Value) -> Outcome {
    let mut input = Input::new(input)?;
    let ids = input.ints("ids", 1, 5);
    input.done()?;

    let mut parts = Vec::new();
    for id in ids.unwrap_or_default() {
        parts.push(match describe(tools, id).await {
            Ok(text) => text,
            Err(error) => format!("Task #{id}: {error}"),
        });
    }
    Ok(parts.join("\n\n"))
}

/// One task, as Claude reads it: its prompt, your feedback, comments, and its newest runs
async fn describe(tools: &Tools<'_>, id: i64) -> Result<String, String> {
    let task = tools.on_this_board(id).await?;
    let notes = runner::ai_notes(tools.db, task.id, tools.owner_id)
        .await
        .map_err(message)?;
    let comments = comments::find_all(tools.db, task.id, tools.owner_id)
        .await
        .map_err(message)?;
    let runs = runner::runs_for(tools.db, task.id, tools.owner_id)
        .await
        .map_err(message)?;
    // Only text that's there and not empty counts (JavaScript's `if (text)`)
    let there = |text: &Option<String>| text.clone().filter(|text| !text.is_empty());

    let mut lines = vec![format!(
        "Task #{} \"{}\" [{}]",
        task.id,
        task.title,
        task.status.as_str()
    )];
    match there(&task.refined_prompt) {
        Some(prompt) => lines.push(format!("Claude's prompt:\n{}", cut(&prompt))),
        None => lines.push("Claude has not written a prompt for it yet.".to_string()),
    }
    if task.changes_requested {
        lines.push("Changes requested: Claude will revise the prompt on its next run.".to_string());
    }
    if let Some(approved) = task.prompt_approved_at {
        lines.push(format!("Prompt approved: {}", approved.text()));
    }
    if let Some(branch) = there(&task.ai_branch) {
        lines.push(format!("Branch: {branch}"));
    }
    if let Some(error) = there(&task.ai_error) {
        lines.push(format!("Runner stopped on it: {error}"));
    }

    for note in notes {
        let who = if note.kind == "claude" {
            "Claude note"
        } else {
            "User feedback on the prompt"
        };
        lines.push(format!("{who}: {}", cut(&note.body)));
    }
    for comment in comments {
        let author = comment.author.display_name.as_deref().unwrap_or(&comment.author.email);
        lines.push(format!("Comment by {author}: {}", cut(&comment.body)));
    }

    if runs.is_empty() {
        lines.push("No runs yet.".to_string());
    }
    for run in runs.iter().take(RUNS_SHOWN) {
        let mut parts = vec![format!(
            "Run {}: {}, {} ({})",
            run.started_at.text(),
            run.step,
            run.status,
            run.result
        )];
        if let Some(passed) = run.checks_passed {
            parts.push(format!("checks {}", if passed { "passed" } else { "failed" }));
        }
        if let Some(error) = there(&run.error) {
            parts.push(format!("error: {}", cut(&error)));
        }
        if let Some(summary) = there(&run.summary) {
            parts.push(format!("summary:\n{}", cut(&summary)));
        }
        lines.push(parts.join(", "));
    }
    Ok(lines.join("\n"))
}

/// Approve a prompt (which starts a build on the user's computer): only when the user clearly asks
pub async fn approve_prompt(tools: &Tools<'_>, input: &Value) -> Outcome {
    let mut input = Input::new(input)?;
    let id = input.int("id");
    input.done()?;

    let task = tools.on_this_board(id.unwrap_or_default()).await?;
    let task = runner::approve(tools.db, task.id, tools.owner_id)
        .await
        .map_err(message)?;
    Ok(format!(
        "Approved the prompt of task #{} \"{}\"; it moved to {}.",
        task.id,
        task.title,
        task.status.as_str()
    ))
}

/// Feedback on a prompt: Claude revises it on its next run
pub async fn request_prompt_changes(tools: &Tools<'_>, input: &Value) -> Outcome {
    let mut input = Input::new(input)?;
    let id = input.int("id");
    let comment = input.text("comment", COMMENT);
    input.done()?;

    let task = tools.on_this_board(id.unwrap_or_default()).await?;
    let comment = comment.unwrap_or_default();
    let task = runner::request_changes(tools.db, task.id, tools.owner_id, &comment)
        .await
        .map_err(message)?;
    Ok(format!(
        "Requested changes on task #{} \"{}\"; Claude will revise its prompt.",
        task.id, task.title
    ))
}

/// A text cut to MAX_TEXT UTF-16 units, as JavaScript's slice does. (Half an emoji at the cut becomes "�": a Rust
/// string can't hold half of one.)
fn cut(text: &str) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    if units.len() <= MAX_TEXT {
        return text.to_string();
    }
    format!("{}… (cut)", String::from_utf16_lossy(&units[..MAX_TEXT]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuts_long_texts_like_javascript() {
        assert_eq!(cut("short"), "short");
        assert_eq!(cut(&"x".repeat(4000)), "x".repeat(4000));
        assert_eq!(cut(&"x".repeat(4001)), format!("{}… (cut)", "x".repeat(4000)));
        // 😀 is two units: 2000 of them fit exactly
        assert_eq!(cut(&"😀".repeat(2001)), format!("{}… (cut)", "😀".repeat(2000)));
    }
}
