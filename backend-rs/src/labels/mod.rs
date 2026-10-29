//! Labels, e.g. "Urgent" in orange (the labels module in NestJS, ../backend/src/labels). Labels belong to a
//! board; a task can have several (setTaskLabels).
//!
//! The files, as NestJS splits them:
//!   types.rs     what the API shows: Label, LabelColor (label.entity.ts, label-color.enum.ts)
//!   inputs.rs    what the operations take, and their input rules (label.dto.ts)
//!   resolver.rs  the GraphQL operations: the login check, the input rules, then the service (labels.resolver.ts)
//!   service.rs   the work itself, with no GraphQL in it (labels.service.ts)

mod inputs;
mod resolver;
mod service;
mod types;

pub use resolver::{LabelsMutation, LabelsQuery};
pub use service::of_tasks;
pub use types::Label;
