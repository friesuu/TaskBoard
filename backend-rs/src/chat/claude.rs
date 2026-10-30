//! Talking to Claude (llm.service.ts in NestJS). There's no Anthropic SDK for Rust, so this sends the HTTP requests
//! itself, exactly as NestJS's SDK (@anthropic-ai/sdk 0.134.0) sends them: the same body, headers, API version,
//! timeout and retries, and the same loop as the SDK's tool runner:
//!
//!   ask Claude ──▶ Claude asks for tools? ──yes──▶ run them, send back their results ──▶ ask Claude again ...
//!                      │ no
//!                      ▼
//!               its answer, as text
//!
//! At most 5 requests per chat message (each one costs money). Tools that fail don't stop the loop: Claude is told
//! the error ("Error: Task 7 not found"), and decides what to do.

use std::time::{Duration, SystemTime};

use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};

use super::tools::{self, Tools};
use crate::errors::service_unavailable;

const CHAT_MODEL: &str = "claude-opus-5-5";

/// The API version NestJS's SDK sends (a request built by hand keeps the version it was written for)
const API_VERSION: &str = "2023-06-01";

/// Server-side fallback: when Claude declines, the API itself retries on the model Anthropic recommends for that
/// kind of refusal (`"fallbacks": "default"` in the body needs this beta)
const BETAS: &str = "server-side-fallback-2026-07-01";

/// At most this many requests to Claude per chat message, which caps the cost (max_iterations in NestJS)
const MAX_ITERATIONS: usize = 5;

/// A failed request is tried again twice (the SDK's maxRetries), for the failures worth retrying
const MAX_RETRIES: u32 = 2;

/// How long one request may take (the SDK's 10 minutes for a request that isn't streamed)
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10 * 60);

const SYSTEM_PROMPT: &str = r#"You are the assistant inside a personal task board app.
Help the user plan, prioritise and manage their own tasks.
Their current tasks (in board order, with ids like #12) and today's date are in <my_tasks> tags at the start of their latest message.
You can create, edit and move tasks, change their labels and checklists, and create, rename and recolour labels, but only when the user asks for a change. Use the ids from <my_tasks> (#12 for tasks, c31 for checklist items).
You cannot delete anything: for a task, tell the user to open it and use "Delete task" at the bottom; for a checklist item, the bin next to it in the task panel; for a label, Board settings.
Only add the AI label when the user asks for it by name, because on a board with a project it sends the task to the Claude runner, which works on it and uses their plan.
The Claude runner works on tasks on boards linked to a project: it writes a prompt (task goes to prompt_review), the user approves it, then it builds it (in_progress, then ai_review).
Use get_ai_details to see a task's prompt, runs, errors and build summary before talking about them.
Only approve a prompt or request changes when the user asks for that task, because approving starts a build on their computer.
After changing something, say in one short sentence what you changed.
Answer briefly in plain text without Markdown, because the chat shows text exactly as written."#;

/// The Claude API, with its key. Made once at start-up and kept in the schema, like the database pool.
pub struct Claude {
    http: reqwest::Client,
    messages_url: String,
    api_key: String,
}

/// One of Claude's answers: what we need of it. `content` stays as Claude wrote it (JSON), because it goes back to
/// Claude unchanged in the next request: its thinking blocks, tool calls and text, in order.
#[derive(Deserialize)]
struct Message {
    content: Vec<Value>,
    stop_reason: Option<String>,
}

/// Why a request to Claude failed, after the retries
enum Failure {
    /// Too many requests (HTTP 429): Claude's rate limit
    RateLimited,
    /// Anything else: a refused request (e.g. a wrong key), Claude overloaded, or no answer at all
    Other(String),
}

impl Claude {
    /// `base_url`: https://api.anthropic.com, or the e2e tests' fake Claude
    pub fn new(base_url: &str, api_key: String) -> Claude {
        Claude {
            http: reqwest::Client::new(),
            messages_url: format!("{}/v1/messages?beta=true", base_url.trim_end_matches('/')),
            api_key,
        }
    }

    /// Sends the conversation (`messages`, ending with your new message) to Claude, runs the tools it asks for, and
    /// gives back its answer as text. Claude being busy or unreachable is the error NestJS sends (HTTP 503 inside).
    pub async fn reply(&self, mut messages: Vec<Value>, tools: &Tools<'_>) -> async_graphql::Result<String> {
        let mut last: Option<Message> = None;
        for _ in 0..MAX_ITERATIONS {
            let message = self.ask(&messages).await.map_err(|failure| match failure {
                Failure::RateLimited => service_unavailable("The assistant is busy. Try again in a minute."),
                Failure::Other(problem) => {
                    // e.g. 401 = a wrong key in .env. Logged for you, never shown to the user.
                    tracing::error!("Claude API error {problem}");
                    service_unavailable("The assistant is unavailable right now.")
                }
            })?;
            // Claude's answer goes into the conversation as it is: the next request continues from it
            messages.push(json!({ "role": "assistant", "content": message.content }));

            let results = match message.stop_reason.as_deref() {
                Some("tool_use") => tools::run_calls(tools, &message.content).await,
                // Paused by the server mid-answer: sent back unchanged, it carries on
                Some("pause_turn" | "compaction") => {
                    last = Some(message);
                    continue;
                }
                _ => None, // end_turn, refusal, max_tokens...: the answer is done
            };
            last = Some(message);
            match results {
                Some(results) => messages.push(json!({ "role": "user", "content": results })),
                None => break,
            }
        }

        // MAX_ITERATIONS is at least 1, so there's always a last answer
        let Some(message) = last else {
            return Err(crate::errors::internal("the tool loop ended without an answer"));
        };
        Ok(match message.stop_reason.as_deref() {
            Some("refusal") => "Sorry, I can't help with that.".to_string(),
            // Still asking for tools after the last request it was allowed
            Some("tool_use") => {
                "That took too many steps, so I stopped. Some changes may already be made; please check the board."
                    .to_string()
            }
            _ => {
                // The answer is a list of blocks (thinking, text...): only the text ones are shown
                let text: String = message
                    .content
                    .iter()
                    .filter(|block| block["type"] == "text")
                    .filter_map(|block| block["text"].as_str())
                    .collect();
                if text.is_empty() {
                    "Sorry, I couldn't come up with an answer.".to_string()
                } else {
                    text
                }
            }
        })
    }

    /// One request to Claude, tried again (up to MAX_RETRIES times) when it fails in a way worth retrying: no
    /// answer at all, a timeout, too many requests, Claude overloaded or broken (the SDK's own rules)
    async fn ask(&self, messages: &[Value]) -> Result<Message, Failure> {
        // The body NestJS's SDK sends, fields in the same order
        let body = json!({
            "model": CHAT_MODEL,
            "max_tokens": 16000,
            "system": SYSTEM_PROMPT,
            "messages": messages,
            "tools": tools::definitions(),
            "output_config": { "effort": "low" },
            "fallbacks": "default",
            "stream": false,
        });

        let body = body.to_string(); // the same text for every try

        let mut retries_left = MAX_RETRIES;
        loop {
            let sent = self
                .http
                .post(&self.messages_url)
                .header("x-api-key", &self.api_key)
                .header("anthropic-version", API_VERSION)
                .header("anthropic-beta", BETAS)
                .header("accept", "application/json")
                .header("content-type", "application/json")
                .timeout(REQUEST_TIMEOUT)
                .body(body.clone())
                .send()
                .await;

            let response = match sent {
                // No answer: the connection failed, or the timeout ran out
                Err(_) if retries_left > 0 => {
                    tokio::time::sleep(backoff(retries_left)).await;
                    retries_left -= 1;
                    continue;
                }
                Err(error) => return Err(Failure::Other(format!("(no answer): {error}"))),
                Ok(response) => response,
            };

            let status = response.status();
            if status.is_success() {
                let unreadable =
                    |error: String| Failure::Other(format!("{status} (an answer that doesn't read): {error}"));
                let bytes = response.bytes().await.map_err(|error| unreadable(error.to_string()))?;
                return serde_json::from_slice(&bytes).map_err(|error| unreadable(error.to_string()));
            }
            if retries_left > 0 && worth_retrying(status, response.headers()) {
                tokio::time::sleep(retry_delay(response.headers(), retries_left)).await;
                retries_left -= 1;
                continue;
            }
            if status == StatusCode::TOO_MANY_REQUESTS {
                return Err(Failure::RateLimited);
            }
            let text = response.text().await.unwrap_or_default();
            return Err(Failure::Other(format!("{}: {text}", status.as_u16())));
        }
    }
}

/// The SDK's rule: the API's own x-should-retry header when it sends one; otherwise a request timeout (408), a lock
/// timeout (409), too many requests (429) and Claude's own failures (500 and up)
fn worth_retrying(status: StatusCode, headers: &HeaderMap) -> bool {
    match headers.get("x-should-retry").and_then(|value| value.to_str().ok()) {
        Some("true") => true,
        Some("false") => false,
        _ => matches!(status.as_u16(), 408 | 409 | 429) || status.is_server_error(),
    }
}

/// How long to wait before trying again: what the API asks for (retry-after-ms, or retry-after in seconds or as a
/// date) when it's a sensible wait, or else `backoff`
fn retry_delay(headers: &HeaderMap, retries_left: u32) -> Duration {
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    let asked_ms = header("retry-after-ms")
        .and_then(|ms| ms.trim().parse::<f64>().ok())
        .or_else(|| {
            let after = header("retry-after")?;
            match after.trim().parse::<f64>() {
                Ok(seconds) => Some(seconds * 1000.0),
                // A date: the time until then
                Err(_) => {
                    let at = httpdate::parse_http_date(after).ok()?;
                    let until = at.duration_since(SystemTime::now()).unwrap_or_default();
                    Some(until.as_secs_f64() * 1000.0)
                }
            }
        });
    match asked_ms {
        // Positive, and no longer than one JavaScript timer can wait (2^31 - 1 ms)
        Some(ms) if ms > 0.0 && ms <= 2_147_483_647.0 => Duration::from_secs_f64(ms / 1000.0),
        _ => backoff(retries_left),
    }
}

/// The SDK's default wait: half a second before the first retry, a second before the second (doubling, at most
/// 8 seconds), each up to a quarter shorter at random, so many clients don't all retry at the same moment
fn backoff(retries_left: u32) -> Duration {
    let retries_done = MAX_RETRIES - retries_left;
    let seconds = (0.5 * 2f64.powi(retries_done as i32)).min(8.0);
    let random = f64::from(OsRng.next_u32()) / f64::from(u32::MAX); // 0 to 1
    Duration::from_secs_f64(seconds * (1.0 - random * 0.25))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(*name, HeaderValue::from_str(value).unwrap());
        }
        map
    }

    #[test]
    fn retries_what_the_sdk_retries() {
        let none = HeaderMap::new();
        for status in [408, 409, 429, 500, 529] {
            assert!(worth_retrying(StatusCode::from_u16(status).unwrap(), &none), "{status}");
        }
        for status in [400, 401, 403, 404, 413] {
            assert!(
                !worth_retrying(StatusCode::from_u16(status).unwrap(), &none),
                "{status}"
            );
        }
        // The API's own say wins
        assert!(!worth_retrying(
            StatusCode::INTERNAL_SERVER_ERROR,
            &headers(&[("x-should-retry", "false")])
        ));
        assert!(worth_retrying(
            StatusCode::BAD_REQUEST,
            &headers(&[("x-should-retry", "true")])
        ));
    }

    #[test]
    fn waits_as_long_as_the_api_asks() {
        assert_eq!(
            retry_delay(&headers(&[("retry-after-ms", "5")]), 2),
            Duration::from_millis(5)
        );
        assert_eq!(
            retry_delay(&headers(&[("retry-after", "2")]), 2),
            Duration::from_secs(2)
        );
        // retry-after-ms first
        assert_eq!(
            retry_delay(&headers(&[("retry-after-ms", "5"), ("retry-after", "2")]), 2),
            Duration::from_millis(5)
        );
        // Nothing sensible asked: the backoff, 0.375 to 0.5 seconds before the first retry
        for asked in [vec![], vec![("retry-after", "0")], vec![("retry-after", "soon")]] {
            let wait = retry_delay(&headers(&asked), 2);
            assert!(
                wait >= Duration::from_millis(375) && wait <= Duration::from_millis(500),
                "{wait:?}"
            );
        }
    }

    #[test]
    fn backs_off_like_the_sdk() {
        let second = backoff(1); // before the second retry: 0.75 to 1 second
        assert!(
            second >= Duration::from_millis(750) && second <= Duration::from_secs(1),
            "{second:?}"
        );
    }
}
