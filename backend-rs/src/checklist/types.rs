//! What the API shows of a checklist (checklist-item.entity.ts in NestJS)

use async_graphql::SimpleObject;

/// One line of a task's checklist, e.g. "[x] Book the room"
#[derive(SimpleObject, sqlx::FromRow)]
pub struct ChecklistItem {
    pub id: i32,
    pub text: String,
    pub done: bool,
    pub position: i32, // order in the checklist: 0 = top
    pub task_id: i32,
}
