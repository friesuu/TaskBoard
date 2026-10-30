//! The Claude runner, as the task board sees it (the runner module in NestJS, ../backend/src/runner). The runner
//! is a program on your laptop that asks the board for work, runs Claude Code, and reports back:
//!
//!   To do ──(runner writes a prompt)──▶ Prompt Review ──(you approve)──▶ In progress ──(runner builds)──▶
//!   AI Review ──(you click Merge, runner merges)──▶ Done
//!
//! Who can do what:
//!   - you, with your login cookie: create or revoke the runner's token (profile page), review its prompts,
//!     ask for a merge, read its runs (task panel, AI Activity page)
//!   - the runner, with its token (`Authorization: Bearer tbr_...`): only its own operations, never anything else
//!
//! The files, as NestJS splits them:
//!   types.rs     what the API shows: RunnerJob, AgentRun, AgentRunLog, AgentStatusInfo... (the entities)
//!   inputs.rs    what the operations take, and their input rules (runner.dto.ts)
//!   resolver.rs  the GraphQL operations, yours and the runner's (the four *.resolver.ts)
//!   tokens.rs    the runner's token, and the login check for the runner's operations (runner-tokens.service.ts,
//!                runner-auth.guard.ts)
//!   jobs.rs      the runner's side of the workflow: the next job, and each step (runner.service.ts)
//!   review.rs    your side of it: edit, approve, ask for changes, merge (prompt-review.service.ts)
//!   activity.rs  the runner's runs, their logs, and what it's doing now (ai-activity.service.ts)
//!   redact.rs    hides anything that looks like a secret in what the runner sends (redact.ts)
//!
//! The state of a task's Claude workflow is in the task's own columns (refined_prompt, approved_prompt,
//! ai_branch, ai_built_at...). Every change to them checks, in the same UPDATE, that the task is still in the
//! state the change is for (see jobs.rs): two steps at the same moment can't both go through.

mod activity;
mod inputs;
mod jobs;
mod redact;
mod resolver;
mod review;
mod tokens;
mod types;

pub use resolver::{AiMutation, AiQuery, RunnerMutation, RunnerQuery};
pub use tokens::bearer_token;
