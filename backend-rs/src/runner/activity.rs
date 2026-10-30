//! The runner's activity (ai-activity.service.ts in NestJS): its runs, each with a step-by-step log, and what it's
//! doing right now. The runner writes it (with its token); you read it (the AI tab, the AI Activity page). Always
//! your own only.

use std::collections::HashMap;

use chrono::{Duration, Utc};
use sqlx::{PgPool, Postgres, Transaction};

use super::inputs::{RunnerLogLineInput, RunnerRunFinishInput, RunnerStatusInput};
use super::redact::redact;
use super::types::{AgentRun, AgentRunLog, AgentStatusInfo};
use crate::errors::{bad_request, internal, not_found};
use crate::scalars::DateTime;
use crate::tasks::{self, Task};
use crate::{boards, notifications};

/// A runaway run can't fill the database: lines past this are dropped
const MAX_LINES_PER_RUN: i64 = 5000;

/// The columns that fill an AgentRun (its task comes after: with_tasks)
const RUN_COLUMNS: &str = "agent_runs.id, agent_runs.task_id, agent_runs.step, agent_runs.status, agent_runs.result,
    agent_runs.project, agent_runs.branch, agent_runs.checks_passed, agent_runs.cost_usd, agent_runs.error,
    agent_runs.summary, agent_runs.started_at, agent_runs.finished_at";

/// How long without a check-in before the runner counts as offline. It checks in every 30 seconds while idle or
/// working, every 2 minutes on battery, at most every 5 minutes while paused and every 10 minutes when today's
/// spend cap is used up; each gets a minute or so to spare.
fn offline_after(state: &str) -> Duration {
    let minutes = match state {
        "unplugged" => 3,
        "paused" => 6,
        "capped" => 11,
        _ => 2,
    };
    Duration::minutes(minutes)
}

fn run_not_found(run_id: i32) -> async_graphql::Error {
    not_found(&format!("Run {run_id} not found"))
}

// ======================= From the runner =======================

/// A step starts on one of your tasks. Gives back the run's id, for its log lines and its finish.
pub async fn start_run(
    db: &PgPool,
    task_id: i32,
    owner_id: i32,
    step: &str,
    branch: Option<&str>,
) -> async_graphql::Result<i32> {
    let task = tasks::find_owned(db, task_id, owner_id).await?;
    let board = boards::find_owned(db, task.board_id, owner_id).await?;
    sqlx::query_scalar(
        "INSERT INTO agent_runs (task_id, step, branch, project, status, result, started_at)
         VALUES ($1, $2, $3, $4, 'running', 'running', now()) RETURNING id",
    )
    .bind(task_id)
    .bind(step)
    .bind(branch)
    .bind(board.project)
    .fetch_one(db)
    .await
    .map_err(internal)
}

/// Locks one of your runs that's still running, until `transaction` ends: meanwhile, another append or the
/// run's finish waits its turn. Anyone else's run looks exactly like one that doesn't exist.
async fn lock_running_run(
    transaction: &mut Transaction<'_, Postgres>,
    run_id: i32,
    owner_id: i32,
) -> async_graphql::Result<()> {
    // FOR UPDATE OF agent_runs: lock the run's row (not its task's)
    let status: Option<String> = sqlx::query_scalar(
        "SELECT agent_runs.status FROM agent_runs JOIN tasks ON tasks.id = agent_runs.task_id
         WHERE agent_runs.id = $1 AND tasks.owner_id = $2 FOR UPDATE OF agent_runs",
    )
    .bind(run_id)
    .bind(owner_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(internal)?;
    match status.as_deref() {
        None => Err(run_not_found(run_id)),
        Some("running") => Ok(()),
        Some(_) => Err(bad_request(&format!("Run {run_id} has already finished"))),
    }
}

/// More lines of a running run's log, secrets hidden. false: the run already has as many lines as it may.
pub async fn append_log(
    db: &PgPool,
    run_id: i32,
    owner_id: i32,
    lines: Vec<RunnerLogLineInput>,
) -> async_graphql::Result<bool> {
    let mut transaction = db.begin().await.map_err(internal)?;
    lock_running_run(&mut transaction, run_id, owner_id).await?;

    let saved: i64 = sqlx::query_scalar("SELECT count(*) FROM agent_run_logs WHERE run_id = $1")
        .bind(run_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(internal)?;
    let room = usize::try_from(MAX_LINES_PER_RUN - saved).unwrap_or(0); // below 0: 0
    if room == 0 {
        return Ok(false);
    }

    // The lines as three lists, side by side; UNNEST turns them back into rows, one per line, in order
    let lines = &lines[..lines.len().min(room)];
    let at: Vec<chrono::DateTime<Utc>> = lines.iter().map(|line| line.at.0).collect();
    let kind: Vec<&str> = lines.iter().map(|line| line.kind.as_str()).collect();
    let text: Vec<String> = lines.iter().map(|line| redact(&line.text)).collect();
    sqlx::query(
        "INSERT INTO agent_run_logs (run_id, at, kind, text)
         SELECT $1, * FROM UNNEST($2::timestamptz[], $3::varchar[], $4::text[])",
    )
    .bind(run_id)
    .bind(at)
    .bind(kind)
    .bind(text)
    .execute(&mut *transaction)
    .await
    .map_err(internal)?;
    transaction.commit().await.map_err(internal)?;
    Ok(true)
}

/// The step ended. The error and the summary are saved with their secrets hidden; an empty one as none.
pub async fn finish_run(
    db: &PgPool,
    run_id: i32,
    owner_id: i32,
    input: RunnerRunFinishInput,
) -> async_graphql::Result<()> {
    let mut transaction = db.begin().await.map_err(internal)?;
    lock_running_run(&mut transaction, run_id, owner_id).await?;

    let hidden = |text: Option<String>| text.filter(|text| !text.is_empty()).map(|text| redact(&text));
    sqlx::query(
        "UPDATE agent_runs SET status = $2, result = $3, checks_passed = $4, cost_usd = $5, error = $6, summary = $7,
            finished_at = now()
         WHERE id = $1",
    )
    .bind(run_id)
    .bind(input.status)
    .bind(input.result)
    .bind(input.checks_passed)
    .bind(input.cost_usd)
    .bind(hidden(input.error))
    .bind(hidden(input.summary))
    .execute(&mut *transaction)
    .await
    .map_err(internal)?;
    transaction.commit().await.map_err(internal)?;
    Ok(())
}

/// What the runner is doing now (one row per user). Reaching the usage limit is worth a notification, once per
/// pause.
pub async fn report_status(db: &PgPool, owner_id: i32, input: RunnerStatusInput) -> async_graphql::Result<()> {
    let before: Option<(String, Option<i32>)> =
        sqlx::query_as("SELECT state, task_id FROM agent_status WHERE user_id = $1")
            .bind(owner_id)
            .fetch_optional(db)
            .await
            .map_err(internal)?;
    // Only one of your own tasks can be named: anyone else's, or one that doesn't exist, is saved as none
    let task_id = match input.task_id {
        Some(id) => tasks::find_owned(db, id, owner_id).await.ok().map(|task| task.id),
        None => None,
    };
    // The same state on the same task keeps its start time ("working for 1m 05s"); anything else starts now
    let same_state = before
        .as_ref()
        .is_some_and(|(state, before_task)| *state == input.state && *before_task == task_id);

    // A new row, or the user's row changed (ON CONFLICT: the user already has one). EXCLUDED: the new values.
    sqlx::query(
        "INSERT INTO agent_status (user_id, state, task_id, step, paused_until, state_since, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, task_id = EXCLUDED.task_id,
            step = EXCLUDED.step, paused_until = EXCLUDED.paused_until,
            state_since = CASE WHEN $6 THEN agent_status.state_since ELSE EXCLUDED.state_since END,
            last_seen_at = EXCLUDED.last_seen_at",
    )
    .bind(owner_id)
    .bind(&input.state)
    .bind(task_id)
    .bind(input.step)
    .bind(input.paused_until)
    .bind(same_state)
    .execute(db)
    .await
    .map_err(internal)?;

    let was_paused = before.is_some_and(|(state, _)| state == "paused");
    if input.state == "paused" && !was_paused {
        let message = "Usage limit reached: the runner waits until it resets";
        notifications::notify(db, owner_id, "usage_limit", message, None).await?;
    }
    Ok(())
}

// ======================= For you =======================

/// A task's runs, newest first (the AI tab)
pub async fn runs_for(db: &PgPool, task_id: i32, owner_id: i32) -> async_graphql::Result<Vec<AgentRun>> {
    let task = tasks::find_owned(db, task_id, owner_id).await?;
    let mut runs: Vec<AgentRun> = sqlx::query_as(&format!(
        "SELECT {RUN_COLUMNS} FROM agent_runs WHERE agent_runs.task_id = $1
         ORDER BY agent_runs.started_at DESC, agent_runs.id DESC LIMIT 50"
    ))
    .bind(task_id)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    // All of them are this task's
    for run in &mut runs {
        run.task = Some(task.clone());
    }
    Ok(runs)
}

/// The AI Activity page: your newest 100 runs on every board, optionally only the running, succeeded or failed
/// ones. (NestJS loads only each task's id, title and board, which is what the page shows; here it's the whole
/// task, as for a notification.)
pub async fn activity(db: &PgPool, owner_id: i32, status: Option<&str>) -> async_graphql::Result<Vec<AgentRun>> {
    let runs: Vec<AgentRun> = sqlx::query_as(&format!(
        "SELECT {RUN_COLUMNS} FROM agent_runs JOIN tasks ON tasks.id = agent_runs.task_id
         WHERE tasks.owner_id = $1 AND ($2::text IS NULL OR agent_runs.status = $2)
         ORDER BY agent_runs.started_at DESC, agent_runs.id DESC LIMIT 100"
    ))
    .bind(owner_id)
    .bind(status)
    .fetch_all(db)
    .await
    .map_err(internal)?;
    with_tasks(db, runs).await
}

/// The runs, each with its task, from one more query for all of them together
async fn with_tasks(db: &PgPool, mut runs: Vec<AgentRun>) -> async_graphql::Result<Vec<AgentRun>> {
    let ids: Vec<i32> = runs.iter().map(|run| run.task_id).collect();
    let tasks: HashMap<i32, Task> = tasks::find_many(db, &ids)
        .await?
        .into_iter()
        .map(|task| (task.id, task))
        .collect();
    for run in &mut runs {
        run.task = tasks.get(&run.task_id).cloned();
    }
    Ok(runs)
}

/// One run's step-by-step log, in order
pub async fn run_log(db: &PgPool, run_id: i32, owner_id: i32) -> async_graphql::Result<Vec<AgentRunLog>> {
    let yours: Option<i32> = sqlx::query_scalar(
        "SELECT agent_runs.id FROM agent_runs JOIN tasks ON tasks.id = agent_runs.task_id
         WHERE agent_runs.id = $1 AND tasks.owner_id = $2",
    )
    .bind(run_id)
    .bind(owner_id)
    .fetch_optional(db)
    .await
    .map_err(internal)?;
    if yours.is_none() {
        return Err(run_not_found(run_id));
    }
    sqlx::query_as("SELECT id, run_id, at, kind, text FROM agent_run_logs WHERE run_id = $1 ORDER BY id")
        .bind(run_id)
        .fetch_all(db)
        .await
        .map_err(internal)
}

/// One row of agent_status: what the runner last said it was doing
#[derive(sqlx::FromRow)]
struct StatusRow {
    state: String,
    task_id: Option<i32>,
    step: Option<String>,
    paused_until: Option<DateTime>,
    state_since: DateTime,
    last_seen_at: DateTime,
}

/// What your runner is doing: what it last said, "offline" when that was too long ago, or "never"
pub async fn agent_status(db: &PgPool, owner_id: i32) -> async_graphql::Result<AgentStatusInfo> {
    let row: Option<StatusRow> = sqlx::query_as(
        "SELECT state, task_id, step, paused_until, state_since, last_seen_at FROM agent_status WHERE user_id = $1",
    )
    .bind(owner_id)
    .fetch_optional(db)
    .await
    .map_err(internal)?;
    let Some(status) = row else {
        return Ok(AgentStatusInfo {
            state: "never".to_string(),
            task: None,
            step: None,
            paused_until: None,
            state_since: None,
            last_seen_at: None,
        });
    };

    let offline = Utc::now() - status.last_seen_at.0 > offline_after(&status.state);
    // The task it's working on, if it's still there and yours
    let task = match status.task_id {
        Some(id) if !offline => tasks::find_owned(db, id, owner_id).await.ok(),
        _ => None,
    };
    Ok(AgentStatusInfo {
        state: if offline { "offline".to_string() } else { status.state },
        task,
        step: if offline { None } else { status.step },
        paused_until: status.paused_until,
        state_since: Some(status.state_since),
        last_seen_at: Some(status.last_seen_at),
    })
}
