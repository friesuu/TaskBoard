//! Comments on a task (the comments module in NestJS, ../backend/src/comments). Only the one who wrote a
//! comment can edit or delete it.
//!
//! The files, as NestJS splits them:
//!   types.rs     what the API shows: Comment (task-comment.entity.ts)
//!   inputs.rs    what the operations take, and their input rules (comment.dto.ts)
//!   resolver.rs  the GraphQL operations: the login check, the input rules, then the service (comments.resolver.ts)
//!   service.rs   the work itself, with no GraphQL in it (comments.service.ts)

mod inputs;
mod resolver;
mod service;
mod types;

pub use resolver::{CommentsMutation, CommentsQuery};
