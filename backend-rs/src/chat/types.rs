//! What the API shows of the chat (chat-message.entity.ts in NestJS)

use async_graphql::SimpleObject;

use crate::scalars::DateTime;

/// One message of your conversation with the assistant
#[derive(SimpleObject, sqlx::FromRow)]
pub struct ChatMessage {
    pub id: i32,
    pub role: String, // "user": you wrote it; "assistant": Claude did (the names the Claude API uses)
    pub content: String,
    pub created_at: DateTime,
    // How long Claude took to answer, in milliseconds, tools included. Only on Claude's answers (and not on very
    // old ones).
    pub response_ms: Option<i32>,
}
