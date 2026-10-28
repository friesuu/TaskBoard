//! GraphQL errors in the shape NestJS sends them, because the frontend reads that shape: it logs you out
//! on `extensions.code == "UNAUTHENTICATED"`, and shows `extensions.originalError.message` for others.
//! What NestJS sends for `me` without a login cookie (HTTP 200, like every GraphQL answer):
//!
//! ```text
//! {"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":3}],"path":["me"],
//!   "extensions":{"code":"UNAUTHENTICATED","originalError":{"message":"Unauthorized","statusCode":401}}}],
//!  "data":null}
//! ```

use async_graphql::{Error, ErrorExtensions, value};

/// No login cookie, a forged or expired one, or one from before a password change
pub fn unauthorized() -> Error {
    Error::new("Unauthorized").extend_with(|_, extensions| {
        extensions.set("code", "UNAUTHENTICATED");
        extensions.set(
            "originalError",
            value!({ "message": "Unauthorized", "statusCode": 401 }),
        );
    })
}

/// Something broke on our side (e.g. the database didn't answer). The details go to the log, never to the
/// person using the app. `impl Display`: anything that can be written out as text, like sqlx's errors.
pub fn internal(problem: impl std::fmt::Display) -> Error {
    tracing::error!("{problem}");
    Error::new("Internal server error").extend_with(|_, extensions| {
        extensions.set("code", "INTERNAL_SERVER_ERROR");
    })
}

// Tests sit next to the code in Rust. `cargo test` runs them; the real program leaves them out.
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unauthorized_is_the_same_as_nestjs() {
        let error = unauthorized().into_server_error(Default::default());

        let sent = serde_json::to_value(&error).unwrap();

        assert_eq!(sent["message"], "Unauthorized");
        assert_eq!(
            sent["extensions"],
            json!({ "code": "UNAUTHENTICATED", "originalError": { "message": "Unauthorized", "statusCode": 401 } })
        );
    }
}
