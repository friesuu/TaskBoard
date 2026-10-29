//! Logging in and out, registering, changing the password and the time zone, and knowing who's logged in (the
//! auth module in NestJS, ../backend/src/auth).
//!
//! The files, as NestJS splits them:
//!   session.rs   the login token and its cookie, and current_user (jwt.strategy.ts, gql-auth.guard.ts...)
//!   inputs.rs    what the operations take, and their input rules (the DTOs)
//!   resolver.rs  the GraphQL operations, in NestJS's order of checks (auth.resolver.ts)
//!   service.rs   the work itself, with no GraphQL in it (auth.service.ts)

mod inputs;
mod resolver;
mod service;
mod session;

pub use resolver::AuthMutation;
pub use service::password_is;
pub use session::{JwtKeys, clear_login_cookie, current_user, login_cookie};
