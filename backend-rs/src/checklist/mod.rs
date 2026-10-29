//! Checklists: the "[x] Book the room" lines of a task (the checklist module in NestJS, ../backend/src/checklist).
//! The card shows their progress ("2/5"): that's counted with the task (TASK_COLUMNS in tasks/service.rs).
//!
//! The files, as NestJS splits them:
//!   types.rs     what the API shows: ChecklistItem (checklist-item.entity.ts)
//!   inputs.rs    what the operations take, and their input rules (checklist-item.dto.ts)
//!   resolver.rs  the GraphQL operations: the login check, the input rules, then the service (checklist.resolver.ts)
//!   service.rs   the work itself, with no GraphQL in it (checklist.service.ts)

mod inputs;
mod resolver;
mod service;
mod types;

pub use resolver::{ChecklistMutation, ChecklistQuery};
