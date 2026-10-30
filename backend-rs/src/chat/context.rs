//! The board written out for Claude (describeLabels and describeTasks in chat.service.ts). It goes in front of your
//! message, between <my_tasks> tags, so Claude knows what's on the board right now:
//!
//! ```text
//! Labels on this board: AI (purple), Urgent (orange)
//! - #12 [todo] Pay invoice (due 2026-10-20) {labels: Urgent}: ask Tom
//!     [x] c31 Find the invoice
//!     [ ] c32 Pay it
//! - #13 [prompt_review] Write report {labels: AI} (Claude revising prompt)
//! ```

use crate::checklist::ChecklistItem;
use crate::labels::Label;
use crate::tasks::Task;

/// The board's labels: "Labels on this board: AI (purple), Urgent (orange)" (each with its colour's name,
/// `label.color.as_str()`), or "Labels on this board: none yet."
pub fn describe_labels(labels: &[Label]) -> String {
    if labels.is_empty() {
        return "Labels on this board: none yet.".to_string();
    }
    let labels: Vec<String> = labels
        .iter()
        .map(|label| format!("{} ({})", label.name, label.color.as_str()))
        .collect();
    format!("Labels on this board: {}", labels.join(", "))
}

/// One line per task, in board order, each followed by its checklist items (`items` has every task's), or
/// "No tasks yet.". A task's line: "- #12 [todo] Pay invoice", then whichever of these it has, in this order:
///   " (due 2026-10-20)"              its due date
///   " {labels: Urgent, AI}"          its labels
///   " (Claude revising prompt)"      changes_requested
///   " (runner stopped)"              an ai_error (that isn't empty)
///   ": ask Tom"                      its description (if it isn't empty)
/// and each of its checklist items on a line of its own: "\n    [x] c31 Find the invoice" ([ ] when not done).
pub fn describe_tasks(tasks: &[Task], items: &[ChecklistItem]) -> String {
    if tasks.is_empty() {
        return "No tasks yet.".to_string();
    }
    let lines: Vec<String> = tasks
        .iter()
        .map(|task| {
            let mut line = format!("- #{} [{}] {}", task.id, task.status.as_str(), task.title);
            if let Some(due_date) = &task.due_date {
                line.push_str(&format!(" (due {due_date})"));
            }
            if !task.labels.is_empty() {
                let names: Vec<&str> = task.labels.iter().map(|label| label.name.as_str()).collect();
                line.push_str(&format!(" {{labels: {}}}", names.join(", ")));
            }
            if task.changes_requested {
                line.push_str(" (Claude revising prompt)");
            }
            if task.ai_error.as_deref().is_some_and(|error| !error.is_empty()) {
                line.push_str(" (runner stopped)");
            }
            if let Some(description) = task.description.as_deref().filter(|text| !text.is_empty()) {
                line.push_str(&format!(": {description}"));
            }
            for item in items.iter().filter(|item| item.task_id == task.id) {
                let tick = if item.done { "x" } else { " " };
                line.push_str(&format!("\n    [{tick}] c{} {}", item.id, item.text));
            }
            line
        })
        .collect();
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::labels::LabelColor;
    use crate::scalars::DateTime;
    use crate::tasks::TaskStatus;

    fn label(id: i32, name: &str, color: LabelColor) -> Label {
        Label {
            id,
            name: name.to_string(),
            color,
            board_id: 1,
        }
    }

    /// A task with nothing but an id, a title and a column; a test sets what else it needs
    fn task(id: i32, title: &str, status: TaskStatus) -> Task {
        Task {
            id,
            title: title.to_string(),
            description: None,
            status,
            due_date: None,
            position: 0,
            created_at: DateTime("2026-10-30T00:00:00Z".parse().unwrap()),
            refined_prompt: None,
            changes_requested: false,
            prompt_approved_at: None,
            ai_branch: None,
            ai_built_at: None,
            ai_checks_passed: None,
            ai_merge_requested_at: None,
            ai_merged_at: None,
            ai_error: None,
            board_id: 1,
            checklist_total: 0,
            checklist_done: 0,
            attachment_count: 0,
            labels: Vec::new(),
        }
    }

    fn item(id: i32, task_id: i32, text: &str, done: bool) -> ChecklistItem {
        ChecklistItem {
            id,
            text: text.to_string(),
            done,
            position: 0,
            task_id,
        }
    }

    #[test]
    fn the_labels() {
        assert_eq!(describe_labels(&[]), "Labels on this board: none yet.");
        assert_eq!(
            describe_labels(&[
                label(1, "AI", LabelColor::Purple),
                label(2, "Urgent", LabelColor::Orange)
            ]),
            "Labels on this board: AI (purple), Urgent (orange)"
        );
    }

    // The board NestJS described in the phase 8 capture (target/phase8/nestjs.json), with these ids
    #[test]
    fn a_board_like_nestjs() {
        let mut invoice = task(12, "Pay invoice", TaskStatus::Todo);
        invoice.due_date = Some("2026-11-20".to_string());
        invoice.labels = vec![label(2, "Urgent", LabelColor::Orange)];
        invoice.description = Some("ask Tom".to_string());
        let mut report = task(13, "Write report", TaskStatus::PromptReview);
        report.labels = vec![label(1, "AI", LabelColor::Purple)];
        let old = task(14, "Old thing", TaskStatus::Done);
        let items = [item(31, 12, "Find the invoice", true), item(32, 12, "Pay it", false)];

        assert_eq!(
            describe_tasks(&[invoice, report, old], &items),
            "- #12 [todo] Pay invoice (due 2026-11-20) {labels: Urgent}: ask Tom\n    [x] c31 Find the invoice\n    [ ] c32 Pay it\n- #13 [prompt_review] Write report {labels: AI}\n- #14 [done] Old thing"
        );
    }

    #[test]
    fn everything_a_task_can_show() {
        let mut task = task(7, "Fix login", TaskStatus::InProgress);
        task.labels = vec![
            label(1, "AI", LabelColor::Purple),
            label(2, "Urgent", LabelColor::Orange),
        ];
        task.changes_requested = true;
        task.ai_error = Some("Spend cap reached".to_string());
        task.description = Some(" raw ".to_string()); // as it is, spaces too
        let items = [
            item(5, 8, "Another task's item", false),
            item(6, 7, "Check the logs", false),
        ];
        assert_eq!(
            describe_tasks(&[task], &items),
            "- #7 [in_progress] Fix login {labels: AI, Urgent} (Claude revising prompt) (runner stopped):  raw \n    [ ] c6 Check the logs"
        );
    }

    #[test]
    fn empty_ones_dont_show() {
        let mut task = task(7, "Fix login", TaskStatus::AiReview);
        task.ai_error = Some(String::new());
        task.description = Some(String::new());
        assert_eq!(describe_tasks(&[task], &[]), "- #7 [ai_review] Fix login");
        assert_eq!(describe_tasks(&[], &[]), "No tasks yet.");
    }
}
