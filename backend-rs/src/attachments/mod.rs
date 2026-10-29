//! Files attached to tasks (the attachments module in NestJS, ../backend/src/attachments). Uploading and
//! downloading are normal web addresses; listing and deleting are GraphQL, like everything else.
//!
//! The files, as NestJS splits them:
//!   types.rs        what the API shows: Attachment (attachment.entity.ts)
//!   file_types.rs   which files are allowed, and their cleaned-up names (file-types.ts)
//!   upload_form.rs  reading the upload's form, the way NestJS's upload libraries read it (FileInterceptor)
//!   storage.rs      the folder the bytes live in (storage.service.ts)
//!   routes.rs       the upload and download addresses (attachments.controller.ts)
//!   resolver.rs     listing and deleting, in GraphQL (attachments.resolver.ts)
//!   service.rs      the work itself, and the clean-up of files nobody points at (attachments.service.ts)

mod file_types;
mod resolver;
mod routes;
mod service;
mod storage;
mod types;
mod upload_form;

pub use resolver::{AttachmentsMutation, AttachmentsQuery};
pub use routes::{download, upload};
pub use service::{clean_up_regularly, remove_stored_files, storage_keys_owned_by};
