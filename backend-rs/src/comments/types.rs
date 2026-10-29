//! What the API shows of comments (task-comment.entity.ts in NestJS)

use async_graphql::SimpleObject;

use crate::scalars::DateTime;
use crate::users::User;

/// A comment on a task, with who wrote it
#[derive(SimpleObject)]
pub struct Comment {
    pub id: i32,
    pub body: String,
    pub created_at: DateTime,
    pub updated_at: DateTime, // changes when the comment is edited, so the app can show "(edited)"
    pub task_id: i32,
    pub author: User,
    // "comment": yours, under Comments. The AI tab has the other two, which can't be edited: "feedback" (what
    // you told Claude when you rejected its prompt) and "claude" (a note from the runner, from before it had
    // its own log)
    pub kind: String,
    pub from_runner: bool, // kind is "claude": shown as "Claude"
}
