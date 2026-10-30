//! Tasks (the tasks module in NestJS, ../backend/src/tasks). A task is on one board, in one column (its status),
//! at a position in that column (0 = top). Someone else's task gives the same "Task 7 not found" as one that
//! doesn't exist; someone else's board just has no tasks.
//!
//! The files, as NestJS splits them:
//!   types.rs     what the API shows: Task, TaskStatus, TaskStats (task.entity.ts, tasks-status.enum.ts...)
//!   inputs.rs    what the operations take, and their input rules (the DTOs)
//!   resolver.rs  the GraphQL operations: the login check, the input rules, then the service (tasks.resolver.ts)
//!   service.rs   the work itself, with no GraphQL in it (tasks.service.ts)
//!
//! mod.rs is the module's front door, like tasks.module.ts: it lists the files, and says what the rest of the
//! backend may use. Everything else in them stays inside this module.

mod inputs;
mod resolver;
mod service;
mod types;

// `pub use`: these can be used from outside as tasks::TasksQuery, tasks::find_owned..., as if written here
pub use inputs::MoveTaskInput;
pub use resolver::{TasksMutation, TasksQuery};
pub use service::{find_many, find_owned, move_to};
pub use types::{Task, TaskStatus};
