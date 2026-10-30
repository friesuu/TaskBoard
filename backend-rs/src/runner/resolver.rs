//! The GraphQL operations about the runner: the login check, the input rules, then the work (runner.resolver.ts,
//! runner-token.resolver.ts, prompt-review.resolver.ts and ai-activity.resolver.ts in NestJS).
//!
//! Two login checks, never mixed:
//!   AiQuery, AiMutation          yours, with your login cookie (auth::current_user)
//!   RunnerQuery, RunnerMutation  the runner's, with its token (tokens::runner_user)

use async_graphql::{Context, Object};
use sqlx::PgPool;

use super::inputs::{
    PromptChangesInput, RefinedPromptInput, RunnerBuildResultInput, RunnerBuildStartInput, RunnerErrorInput,
    RunnerLogInput, RunnerPromptInput, RunnerRunFinishInput, RunnerRunStartInput, RunnerStatusInput,
};
use super::tokens::{self, runner_user};
use super::types::{AgentRun, AgentRunLog, AgentStatusInfo, RunnerJob, RunnerJobKind, RunnerTokenInfo};
use super::{activity, jobs, review};
use crate::auth::current_user;
use crate::comments::Comment;
use crate::errors::{bad_request, null_on_error};
use crate::tasks::Task;

/// The statuses aiRuns can show
const RUN_STATUSES: &[&str] = &["running", "succeeded", "failed"];

// ======================= Yours: the task panel, the AI Activity page, the profile =======================

/// Your part of the GraphQL Query type about the runner
#[derive(Default)]
pub struct AiQuery;

#[Object]
impl AiQuery {
    /// Your runner token's details (never the token itself), or null if you haven't made one
    async fn runner_token(&self, ctx: &Context<'_>) -> Option<RunnerTokenInfo> {
        let info = async {
            let user = current_user(ctx).await?;
            tokens::info(ctx.data::<PgPool>()?, user.id).await
        };
        null_on_error(ctx, info.await)
    }

    /// A task's runs (each step Claude took, newest first)
    async fn agent_runs(&self, ctx: &Context<'_>, task_id: i32) -> async_graphql::Result<Vec<AgentRun>> {
        let user = current_user(ctx).await?;
        activity::runs_for(ctx.data::<PgPool>()?, task_id, user.id).await
    }

    /// Your feedback on Claude's prompts, and Claude's older notes (the AI tab)
    async fn ai_notes(&self, ctx: &Context<'_>, task_id: i32) -> async_graphql::Result<Vec<Comment>> {
        let user = current_user(ctx).await?;
        review::ai_notes(ctx.data::<PgPool>()?, task_id, user.id).await
    }

    /// What your runner is doing: working, idle, paused, unplugged, capped, offline, or never seen
    async fn agent_status(&self, ctx: &Context<'_>) -> async_graphql::Result<AgentStatusInfo> {
        let user = current_user(ctx).await?;
        activity::agent_status(ctx.data::<PgPool>()?, user.id).await
    }

    /// Your newest 100 runs on every board. status: running, succeeded or failed (none, or "": all)
    async fn ai_runs(&self, ctx: &Context<'_>, status: Option<String>) -> async_graphql::Result<Vec<AgentRun>> {
        let user = current_user(ctx).await?;
        let status = status.filter(|status| !status.is_empty());
        if let Some(status) = &status
            && !RUN_STATUSES.contains(&status.as_str())
        {
            return Err(bad_request(&format!(
                "status must be one of: {}",
                RUN_STATUSES.join(", ")
            )));
        }
        activity::activity(ctx.data::<PgPool>()?, user.id, status.as_deref()).await
    }

    /// One run's step-by-step log
    async fn agent_run_log(&self, ctx: &Context<'_>, run_id: i32) -> async_graphql::Result<Vec<AgentRunLog>> {
        let user = current_user(ctx).await?;
        activity::run_log(ctx.data::<PgPool>()?, run_id, user.id).await
    }
}

/// Your part of the GraphQL Mutation type about the runner
#[derive(Default)]
pub struct AiMutation;

#[Object]
impl AiMutation {
    /// A new runner token, replacing (revoking) any old one: the only time it's ever shown. Only with your login
    /// cookie: the runner's own token can't make or revoke tokens.
    async fn create_runner_token(&self, ctx: &Context<'_>) -> async_graphql::Result<String> {
        let user = current_user(ctx).await?;
        tokens::create(ctx.data::<PgPool>()?, user.id).await
    }

    async fn revoke_runner_token(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        tokens::revoke(ctx.data::<PgPool>()?, user.id).await?;
        Ok(true)
    }

    async fn update_refined_prompt(
        &self,
        ctx: &Context<'_>,
        task_id: i32,
        input: RefinedPromptInput,
    ) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        review::edit_prompt(ctx.data::<PgPool>()?, task_id, user.id, &input.prompt).await
    }

    async fn approve_prompt(&self, ctx: &Context<'_>, task_id: i32) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        review::approve(ctx.data::<PgPool>()?, task_id, user.id).await
    }

    async fn request_prompt_changes(
        &self,
        ctx: &Context<'_>,
        task_id: i32,
        input: PromptChangesInput,
    ) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        review::request_changes(ctx.data::<PgPool>()?, task_id, user.id, &input.comment).await
    }

    async fn request_ai_merge(&self, ctx: &Context<'_>, task_id: i32) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        review::request_merge(ctx.data::<PgPool>()?, task_id, user.id).await
    }

    async fn retry_ai_task(&self, ctx: &Context<'_>, task_id: i32) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        review::retry(ctx.data::<PgPool>()?, task_id, user.id).await
    }
}

// ======================= The runner's own (its token) =======================

/// The runner's part of the GraphQL Query type
#[derive(Default)]
pub struct RunnerQuery;

#[Object]
impl RunnerQuery {
    /// The runner's start-up check: "is my token valid?"
    async fn runner_ping(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        runner_user(ctx).await?;
        Ok(true)
    }

    /// The next job, or null when there's nothing to do. kinds: the jobs this runner can do (left out by runners
    /// from before MERGE existed: then BUILD and REFINE)
    async fn runner_next_job(&self, ctx: &Context<'_>, kinds: Option<Vec<RunnerJobKind>>) -> Option<RunnerJob> {
        let job = async {
            let user = runner_user(ctx).await?;
            let kinds = kinds.unwrap_or_else(|| vec![RunnerJobKind::Build, RunnerJobKind::Refine]);
            jobs::next_job(ctx.data::<PgPool>()?, user.id, &kinds).await
        };
        null_on_error(ctx, job.await)
    }
}

/// The runner's part of the GraphQL Mutation type
#[derive(Default)]
pub struct RunnerMutation;

#[Object]
impl RunnerMutation {
    async fn runner_save_prompt(
        &self,
        ctx: &Context<'_>,
        task_id: i32,
        input: RunnerPromptInput,
    ) -> async_graphql::Result<Task> {
        let user = runner_user(ctx).await?;
        let input = input.checked()?;
        jobs::save_prompt(ctx.data::<PgPool>()?, task_id, user.id, &input.prompt).await
    }

    async fn runner_start_build(
        &self,
        ctx: &Context<'_>,
        task_id: i32,
        input: RunnerBuildStartInput,
    ) -> async_graphql::Result<Task> {
        let user = runner_user(ctx).await?;
        let input = input.checked()?;
        jobs::start_build(ctx.data::<PgPool>()?, task_id, user.id, &input.branch).await
    }

    async fn runner_finish_build(
        &self,
        ctx: &Context<'_>,
        task_id: i32,
        input: RunnerBuildResultInput,
    ) -> async_graphql::Result<Task> {
        let user = runner_user(ctx).await?;
        jobs::finish_build(ctx.data::<PgPool>()?, task_id, user.id, input.checks_passed).await
    }

    async fn runner_finish_merge(&self, ctx: &Context<'_>, task_id: i32) -> async_graphql::Result<Task> {
        let user = runner_user(ctx).await?;
        jobs::finish_merge(ctx.data::<PgPool>()?, task_id, user.id).await
    }

    async fn runner_report_error(
        &self,
        ctx: &Context<'_>,
        task_id: i32,
        input: RunnerErrorInput,
    ) -> async_graphql::Result<Task> {
        let user = runner_user(ctx).await?;
        let input = input.checked()?;
        jobs::report_error(ctx.data::<PgPool>()?, task_id, user.id, &input.message).await
    }

    /// A step starts. Gives back the run's id, for its log lines and its finish.
    async fn runner_start_run(
        &self,
        ctx: &Context<'_>,
        task_id: i32,
        input: RunnerRunStartInput,
    ) -> async_graphql::Result<i32> {
        let user = runner_user(ctx).await?;
        let input = input.checked()?;
        activity::start_run(
            ctx.data::<PgPool>()?,
            task_id,
            user.id,
            &input.step,
            input.branch.as_deref(),
        )
        .await
    }

    async fn runner_append_log(
        &self,
        ctx: &Context<'_>,
        run_id: i32,
        input: RunnerLogInput,
    ) -> async_graphql::Result<bool> {
        let user = runner_user(ctx).await?;
        let input = input.checked()?;
        activity::append_log(ctx.data::<PgPool>()?, run_id, user.id, input.lines).await
    }

    async fn runner_finish_run(
        &self,
        ctx: &Context<'_>,
        run_id: i32,
        input: RunnerRunFinishInput,
    ) -> async_graphql::Result<bool> {
        let user = runner_user(ctx).await?;
        let input = input.checked()?;
        activity::finish_run(ctx.data::<PgPool>()?, run_id, user.id, input).await?;
        Ok(true)
    }

    async fn runner_report_status(&self, ctx: &Context<'_>, input: RunnerStatusInput) -> async_graphql::Result<bool> {
        let user = runner_user(ctx).await?;
        let input = input.checked()?;
        activity::report_status(ctx.data::<PgPool>()?, user.id, input).await?;
        Ok(true)
    }
}
