//! What the API shows of the runner: runner-token.resolver.ts (RunnerTokenInfo), runner-job.type.ts,
//! agent-run.entity.ts, agent-run-log.entity.ts and agent-status.entity.ts in NestJS

use async_graphql::{ComplexObject, Enum, SimpleObject};

use crate::checklist::ChecklistItem;
use crate::comments::Comment;
use crate::errors::internal;
use crate::scalars::DateTime;
use crate::tasks::Task;

/// What the profile shows about your runner token: never the token itself, which is shown once, when it's made
#[derive(SimpleObject, sqlx::FromRow)]
pub struct RunnerTokenInfo {
    pub created_at: DateTime,
    pub last_used_at: Option<DateTime>, // set each time the runner uses it
}

/// REFINE: write (or revise) a task's prompt. BUILD: carry out an approved prompt. MERGE: merge a built branch
/// you clicked Merge on (no Claude: the runner runs git itself). In GraphQL: REFINE, BUILD, MERGE.
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum RunnerJobKind {
    Refine,
    Build,
    Merge,
}

/// One piece of work for the runner: which step, on which task, in which project, with everything it needs to
/// read. Not a table: jobs.rs puts it together.
#[derive(SimpleObject)]
pub struct RunnerJob {
    pub kind: RunnerJobKind,
    pub project: String, // the board's project; the runner finds its folder in its projects.json
    pub task: Task,
    pub approved_prompt: Option<String>, // BUILD only: the exact prompt you approved (the only thing it may carry out)
    pub comments: Vec<Comment>,          // every kind: yours, your prompt feedback, Claude's old notes
    pub checklist: Vec<ChecklistItem>,
}

/// One run of the runner: one step (refine, build or merge) on one task. Opened when the step starts, so the
/// AI Activity page shows it as running; closed with the result.
/// `complex`: besides these fields, it has `task`, from the ComplexObject below.
#[derive(SimpleObject, sqlx::FromRow)]
#[graphql(complex)]
pub struct AgentRun {
    pub id: i32,
    // Its task, shown by `task` below. Not a column: filled after the query (activity.rs). `Option` only because
    // sqlx needs a value to start with (skip = Default), and Option's is None.
    #[graphql(skip)]
    #[sqlx(skip)]
    pub task: Option<Task>,
    pub task_id: i32,
    pub step: String,   // refine, build or merge
    pub status: String, // running, succeeded or failed
    pub result: String, // in a few words: "prompt saved", "built", "stopped early", "usage limit"...
    pub project: Option<String>,
    pub branch: Option<String>,
    pub checks_passed: Option<bool>, // builds: did the runner's own build and test checks pass?
    pub cost_usd: Option<f64>,       // what Claude Code says the step cost: an estimate, so a plain float
    pub error: Option<String>,
    pub summary: Option<String>, // builds: what changed, which files, the checks, how to try it
    pub started_at: DateTime,
    pub finished_at: Option<DateTime>, // empty while it runs
}

// #[ComplexObject]: fields worked out by a function instead of read from the struct
#[ComplexObject]
impl AgentRun {
    /// The run's task (the AI Activity page shows its title and links to its board)
    async fn task(&self) -> async_graphql::Result<&Task> {
        self.task.as_ref().ok_or_else(|| internal("a run's task wasn't loaded"))
    }
}

/// One line of a run's step-by-step log: something Claude said or did, or one of the runner's own steps.
/// Anything that looks like a secret was hidden before it was saved (redact.rs).
#[derive(SimpleObject, sqlx::FromRow)]
pub struct AgentRunLog {
    pub id: i32,
    pub run_id: i32,
    pub at: DateTime, // when it happened, by the runner's clock
    pub kind: String, // info, claude, thinking, tool, check or error
    pub text: String,
}

/// What your runner is doing, as the app shows it: what it last said (idle, working, paused, unplugged, capped),
/// "offline" when it hasn't checked in for a while (normal: it runs on your laptop), or "never"
#[derive(SimpleObject)]
pub struct AgentStatusInfo {
    pub state: String,
    pub task: Option<Task>, // while working: which task, and which step
    pub step: Option<String>,
    pub paused_until: Option<DateTime>,
    pub state_since: Option<DateTime>, // e.g. "working for 1m 05s"
    pub last_seen_at: Option<DateTime>,
}
