//! What the runner's operations and your prompt review take, and their input rules (runner.dto.ts in NestJS).
//! Each input's `checked` does what NestJS's ValidationPipe does: trims what NestJS trims, checks the rules
//! (fields in order; within a field, its decorators bottom up), and gives it back.

use std::sync::LazyLock;

use async_graphql::InputObject;
use regex::Regex;

use crate::errors::invalid_input;
use crate::scalars::DateTime;
use crate::validate;

/// The steps a run or a status can name
const STEPS: &[&str] = &["refine", "build", "merge"];

/// The kinds of log line: the runner's own steps, what Claude said, its thinking, the tools it used (files read or
/// edited, commands), the runner's build and test checks, and errors
const LOG_KINDS: &[&str] = &["info", "claude", "thinking", "tool", "check", "error"];

/// The only branch names the runner may use, "ai/task-12-short-title": it never gets to name main or any other
/// branch. ([0-9], not \d: the regex crate's \d also takes other scripts' digits, JavaScript's doesn't.)
fn is_runner_branch(branch: &str) -> bool {
    static BRANCH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^ai/task-[0-9]+(-[a-z0-9]+)*$").unwrap());
    BRANCH.is_match(branch)
}

// ======================= From you (the task panel) =======================

/// The prompt, after your edits (e.g. blanks filled in)
#[derive(InputObject)]
#[graphql(name = "RefinedPromptInput")]
pub struct RefinedPromptInput {
    pub prompt: String,
}

impl RefinedPromptInput {
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.prompt = validate::trimmed("prompt", &self.prompt, 20000)?.to_string();
        Ok(self)
    }
}

/// "Request changes": what Claude should change in the prompt (kept in the AI tab, as a "feedback" comment)
#[derive(InputObject)]
#[graphql(name = "PromptChangesInput")]
pub struct PromptChangesInput {
    pub comment: String,
}

impl PromptChangesInput {
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.comment = validate::trimmed("comment", &self.comment, 2000)?.to_string();
        Ok(self)
    }
}

// ======================= From the runner =======================

/// The prompt Claude wrote
#[derive(InputObject)]
#[graphql(name = "RunnerPromptInput")]
pub struct RunnerPromptInput {
    pub prompt: String,
}

impl RunnerPromptInput {
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.prompt = validate::trimmed("prompt", &self.prompt, 20000)?.to_string();
        Ok(self)
    }
}

/// The branch a build is about to start on
#[derive(InputObject)]
#[graphql(name = "RunnerBuildStartInput")]
pub struct RunnerBuildStartInput {
    pub branch: String,
}

impl RunnerBuildStartInput {
    /// @IsString @MaxLength(100) @Matches(..., { message }), bottom up
    pub fn checked(self) -> async_graphql::Result<Self> {
        validate::check([
            (!is_runner_branch(&self.branch)).then(|| "branch must look like ai/task-12-short-title".to_string()),
            validate::at_most("branch", &self.branch, 100),
        ])?;
        Ok(self)
    }
}

/// How a build went: false when Claude stopped early or the runner's checks failed. Its only rule (@IsBoolean)
/// is GraphQL's own (Boolean!), so it has no `checked`.
#[derive(InputObject)]
#[graphql(name = "RunnerBuildResultInput")]
pub struct RunnerBuildResultInput {
    pub checks_passed: bool,
}

/// Why the runner couldn't carry on (e.g. the spend cap was reached)
#[derive(InputObject)]
#[graphql(name = "RunnerErrorInput")]
pub struct RunnerErrorInput {
    pub message: String,
}

impl RunnerErrorInput {
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.message = validate::trimmed("message", &self.message, 2000)?.to_string();
        Ok(self)
    }
}

// ======================= The runner's activity: runs, their logs, what it's doing now =======================

/// A step starts: the run is opened, so the AI Activity page shows it as running
#[derive(InputObject)]
#[graphql(name = "RunnerRunStartInput")]
pub struct RunnerRunStartInput {
    pub step: String,
    pub branch: Option<String>,
}

impl RunnerRunStartInput {
    pub fn checked(self) -> async_graphql::Result<Self> {
        // branch: @IsOptional @IsString @MaxLength(100) @Matches(...) with class-validator's own message
        let branch = self.branch.as_deref();
        validate::check([
            validate::one_of("step", &self.step, STEPS),
            branch
                .filter(|branch| !is_runner_branch(branch))
                .map(|_| r"branch must match /^ai\/task-\d+(-[a-z0-9]+)*$/ regular expression".to_string()),
            branch.and_then(|branch| validate::at_most("branch", branch, 100)),
        ])?;
        Ok(self)
    }
}

/// One line of a run's log
#[derive(InputObject)]
#[graphql(name = "RunnerLogLineInput")]
pub struct RunnerLogLineInput {
    pub at: DateTime,
    pub kind: String,
    pub text: String,
}

impl RunnerLogLineInput {
    /// The broken rules of one line: kind @IsIn, then text @IsString @IsNotEmpty @MaxLength(4000) bottom up.
    /// (`at` @IsDate: a DateTime that doesn't read as one is refused before this, as a broken request.)
    fn broken_rules(&self) -> Vec<Option<String>> {
        vec![
            validate::one_of("kind", &self.kind, LOG_KINDS),
            validate::at_most("text", &self.text, 4000),
            validate::not_empty("text", &self.text),
        ]
    }
}

/// A few lines of a run's log at a time, while it runs
#[derive(InputObject)]
#[graphql(name = "RunnerLogInput")]
pub struct RunnerLogInput {
    pub lines: Vec<RunnerLogLineInput>,
}

impl RunnerLogInput {
    /// @ArrayMaxSize(200) and each line's own rules (@ValidateNested). A broken line's messages say which line:
    /// "lines.3.kind must be ...". When any line is broken, NestJS only sends those, and leaves out the list's own
    /// rule (its ValidationPipe skips the parent's message when there are children's): the same here.
    pub fn checked(self) -> async_graphql::Result<Self> {
        // flat_map: each line's messages, one after another in one list. `move`: the closure inside keeps its own
        // copy of `index`.
        let broken_lines: Vec<String> = self
            .lines
            .iter()
            .enumerate()
            .flat_map(|(index, line)| {
                let broken = line.broken_rules().into_iter().flatten();
                broken.map(move |message| format!("lines.{index}.{message}"))
            })
            .collect();
        if !broken_lines.is_empty() {
            return Err(invalid_input(broken_lines));
        }
        validate::check([validate::at_most_items("lines", &self.lines, 200)])?;
        Ok(self)
    }
}

/// The step ended
#[derive(InputObject)]
#[graphql(name = "RunnerRunFinishInput")]
pub struct RunnerRunFinishInput {
    pub status: String, // succeeded or failed
    pub result: String, // in a few words: "prompt saved", "built", "stopped early", "usage limit"...
    pub checks_passed: Option<bool>,
    pub cost_usd: Option<f64>,
    pub error: Option<String>,
    pub summary: Option<String>, // builds: what changed, which files, the checks, how to try it
}

impl RunnerRunFinishInput {
    /// Nothing is trimmed here (NestJS doesn't). The optional ones are only checked when they're there.
    pub fn checked(self) -> async_graphql::Result<Self> {
        validate::check([
            validate::one_of("status", &self.status, &["succeeded", "failed"]),
            validate::at_most("result", &self.result, 40),
            validate::not_empty("result", &self.result),
            // costUsd: @IsOptional @IsNumber @Min(0) @Max(1000), bottom up
            self.cost_usd
                .and_then(|cost| validate::not_above("costUsd", cost, 1000.0)),
            self.cost_usd.and_then(|cost| validate::not_below("costUsd", cost, 0.0)),
            self.error
                .as_deref()
                .and_then(|error| validate::at_most("error", error, 2000)),
            self.summary
                .as_deref()
                .and_then(|summary| validate::at_most("summary", summary, 20000)),
        ])?;
        Ok(self)
    }
}

/// What the runner is doing now: sent on every check, and every 30 seconds while a step runs
#[derive(InputObject)]
#[graphql(name = "RunnerStatusInput")]
pub struct RunnerStatusInput {
    pub state: String,
    pub task_id: Option<i32>,
    pub step: Option<String>,
    pub paused_until: Option<DateTime>,
}

impl RunnerStatusInput {
    pub fn checked(self) -> async_graphql::Result<Self> {
        validate::check([
            validate::one_of(
                "state",
                &self.state,
                &["idle", "working", "paused", "unplugged", "capped"],
            ),
            self.step
                .as_deref()
                .and_then(|step| validate::one_of("step", step, STEPS)),
        ])?;
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runner_branches() {
        for good in ["ai/task-12", "ai/task-12-short-title", "ai/task-7-a1-b2"] {
            assert!(is_runner_branch(good), "{good}");
        }
        for bad in [
            "main",
            "ai/task-x",
            "ai/task-12-Upper",
            "ai/task-12-",
            "ai/task-12--two",
            "ai/task-١٢",
        ] {
            assert!(!is_runner_branch(bad), "{bad}");
        }
    }

    fn messages(error: async_graphql::Error) -> serde_json::Value {
        let sent = serde_json::to_value(error.into_server_error(Default::default())).unwrap();
        sent["extensions"]["originalError"]["message"].clone()
    }

    fn line(kind: &str, text: &str) -> RunnerLogLineInput {
        let at = DateTime("2026-10-29T10:00:00Z".parse().unwrap());
        RunnerLogLineInput {
            at,
            kind: kind.to_string(),
            text: text.to_string(),
        }
    }

    // What NestJS answered for the same lines (target/phase7/nestjs.json)
    #[test]
    fn log_lines_like_nestjs() {
        let ok = RunnerLogInput {
            lines: vec![line("info", "ok"), line("nope", "")],
        };
        assert_eq!(
            messages(ok.checked().err().unwrap()),
            serde_json::json!([
                "lines.1.kind must be one of the following values: info, claude, thinking, tool, check, error",
                "lines.1.text should not be empty"
            ])
        );
        let many = RunnerLogInput {
            lines: (0..201).map(|_| line("info", "x")).collect(),
        };
        assert_eq!(
            messages(many.checked().err().unwrap()),
            serde_json::json!(["lines must contain no more than 200 elements"])
        );
        // Too many, and one of them broken: only the broken line's message, as NestJS sends
        let mut both = RunnerLogInput {
            lines: (0..201).map(|_| line("info", "x")).collect(),
        };
        both.lines[5] = line("chat", "x");
        assert_eq!(
            messages(both.checked().err().unwrap()),
            serde_json::json!([
                "lines.5.kind must be one of the following values: info, claude, thinking, tool, check, error"
            ])
        );
    }

    #[test]
    fn a_finished_run_like_nestjs() {
        let everything_wrong = RunnerRunFinishInput {
            status: "meh".to_string(),
            result: String::new(),
            checks_passed: None,
            cost_usd: Some(-1.0),
            error: Some("e".repeat(2001)),
            summary: Some("s".repeat(20001)),
        };
        assert_eq!(
            messages(everything_wrong.checked().err().unwrap()),
            serde_json::json!([
                "status must be one of the following values: succeeded, failed",
                "result should not be empty",
                "costUsd must not be less than 0",
                "error must be shorter than or equal to 2000 characters",
                "summary must be shorter than or equal to 20000 characters"
            ])
        );
        let too_costly = RunnerRunFinishInput {
            status: "succeeded".to_string(),
            result: "built".to_string(),
            checks_passed: None,
            cost_usd: Some(1000.5),
            error: None,
            summary: None,
        };
        assert_eq!(
            messages(too_costly.checked().err().unwrap()),
            serde_json::json!(["costUsd must not be greater than 1000"])
        );
    }
}
