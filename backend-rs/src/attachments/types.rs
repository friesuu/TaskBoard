//! What the API shows of a file attached to a task (attachment.entity.ts in NestJS)

use async_graphql::SimpleObject;
use serde::Serialize;

use crate::scalars::DateTime;

/// A file attached to a task. The bytes are in storage (storage.rs); this describes them. The storage key isn't
/// here at all, so it can never be sent: not by GraphQL, and not by the upload's JSON answer either.
/// Serialize: the upload answers with plain JSON (not GraphQL), with the same camelCase names in the same order.
#[derive(SimpleObject, sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: i32,
    pub file_name: String, // the name it was uploaded with, cleaned up (file_types::clean_file_name)
    pub mime_type: String, // decided by the server from the checked type, never taken from the browser
    pub size: i32,         // in bytes
    pub created_at: DateTime,
    pub task_id: i32,
}
