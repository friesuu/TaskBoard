//! GraphQL errors in the shapes NestJS sends them, because the frontend reads those shapes: it logs you out
//! on `extensions.code == "UNAUTHENTICATED"`, and shows `extensions.originalError.message` for others.
//! Each function below copies one shape exactly (HTTP 200 for all of them, like every GraphQL answer).
//! What NestJS sends for `me` without a login cookie:
//!
//! ```text
//! {"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":3}],"path":["me"],
//!   "extensions":{"code":"UNAUTHENTICATED","originalError":{"message":"Unauthorized","statusCode":401}}}],
//!  "data":null}
//! ```

use async_graphql::{Context, Error, ErrorExtensions, value};

/// No login cookie, a forged or expired one, or one from before a password change (NestJS's login guard)
pub fn unauthorized() -> Error {
    Error::new("Unauthorized").extend_with(|_, extensions| {
        extensions.set("code", "UNAUTHENTICATED");
        extensions.set(
            "originalError",
            value!({ "message": "Unauthorized", "statusCode": 401 }),
        );
    })
}

/// Unauthorized with a message, e.g. "Invalid email or password" (UnauthorizedException('...') in NestJS)
pub fn unauthorized_because(message: &str) -> Error {
    Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", "UNAUTHENTICATED");
        extensions.set(
            "originalError",
            value!({ "message": message, "error": "Unauthorized", "statusCode": 401 }),
        );
    })
}

/// A request we refuse, e.g. "Current password is incorrect" (BadRequestException('...') in NestJS).
/// BAD_REQUEST, not UNAUTHENTICATED, so the frontend doesn't log you out.
pub fn bad_request(message: &str) -> Error {
    Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", "BAD_REQUEST");
        extensions.set(
            "originalError",
            value!({ "message": message, "error": "Bad Request", "statusCode": 400 }),
        );
    })
}

/// Input that breaks the rules (NestJS's ValidationPipe): every broken rule's message, in a list.
/// The message itself is always "Bad Request Exception"; the frontend shows the list.
pub fn invalid_input(messages: Vec<String>) -> Error {
    Error::new("Bad Request Exception").extend_with(move |_, extensions| {
        extensions.set("code", "BAD_REQUEST");
        extensions.set(
            "originalError",
            value!({ "message": messages.clone(), "error": "Bad Request", "statusCode": 400 }),
        );
    })
}

/// Already exists, e.g. "Email is already registered" (ConflictException in NestJS, which sends it with
/// the code INTERNAL_SERVER_ERROR and status 409: odd, but it's what the frontend gets today)
pub fn conflict(message: &str) -> Error {
    Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", "INTERNAL_SERVER_ERROR");
        extensions.set("status", 409);
        extensions.set(
            "originalError",
            value!({ "message": message, "error": "Conflict", "statusCode": 409 }),
        );
    })
}

/// Doesn't exist, or isn't yours, e.g. "Board 7 not found" (NotFoundException in NestJS: the same odd shape as
/// conflict, with status 404)
pub fn not_found(message: &str) -> Error {
    Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", "INTERNAL_SERVER_ERROR");
        extensions.set("status", 404);
        extensions.set(
            "originalError",
            value!({ "message": message, "error": "Not Found", "statusCode": 404 }),
        );
    })
}

/// Over a rate limit (ThrottlerGuard in NestJS: only a code, no details)
pub fn too_many_attempts() -> Error {
    Error::new("Too many attempts. Please wait a minute and try again.").extend_with(|_, extensions| {
        extensions.set("code", "INTERNAL_SERVER_ERROR");
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

/// For a field that can be null (e.g. `runnerToken`): an error makes it null, with the error in the answer's
/// `errors` beside it. That's GraphQL's rule, and NestJS's answer: `{"data":{"runnerToken":null},"errors":[...]}`.
/// async-graphql instead leaves a failed field out of `data`, and with nothing left, sends `"data":null`.
pub fn null_on_error<T>(ctx: &Context<'_>, result: async_graphql::Result<Option<T>>) -> Option<T> {
    result.unwrap_or_else(|error| {
        // where the field is in the query (`locations`) and in the answer (`path`), as for any other error
        ctx.add_error(ctx.set_error_path(error.into_server_error(ctx.item.pos)));
        None
    })
}

// Tests sit next to the code in Rust. `cargo test` runs them; the real program leaves them out.
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    // The error as it's sent: message and extensions
    fn sent(error: Error) -> Value {
        let sent = serde_json::to_value(error.into_server_error(Default::default())).unwrap();
        json!({ "message": sent["message"], "extensions": sent["extensions"] })
    }

    // Each expected value below is what NestJS sent for the same case (captured on 2026-10-28)
    #[test]
    fn the_same_as_nestjs() {
        assert_eq!(
            sent(unauthorized()),
            json!({ "message": "Unauthorized", "extensions": { "code": "UNAUTHENTICATED",
                "originalError": { "message": "Unauthorized", "statusCode": 401 } } })
        );
        assert_eq!(
            sent(unauthorized_because("Invalid email or password")),
            json!({ "message": "Invalid email or password", "extensions": { "code": "UNAUTHENTICATED",
                "originalError": { "message": "Invalid email or password", "error": "Unauthorized", "statusCode": 401 } } })
        );
        assert_eq!(
            sent(bad_request("Password is incorrect")),
            json!({ "message": "Password is incorrect", "extensions": { "code": "BAD_REQUEST",
                "originalError": { "message": "Password is incorrect", "error": "Bad Request", "statusCode": 400 } } })
        );
        assert_eq!(
            sent(invalid_input(vec!["password should not be empty".to_string()])),
            json!({ "message": "Bad Request Exception", "extensions": { "code": "BAD_REQUEST",
                "originalError": { "message": ["password should not be empty"], "error": "Bad Request", "statusCode": 400 } } })
        );
        assert_eq!(
            sent(conflict("Email is already registered")),
            json!({ "message": "Email is already registered", "extensions": { "code": "INTERNAL_SERVER_ERROR", "status": 409,
                "originalError": { "message": "Email is already registered", "error": "Conflict", "statusCode": 409 } } })
        );
        assert_eq!(
            sent(not_found("Board 7 not found")),
            json!({ "message": "Board 7 not found", "extensions": { "code": "INTERNAL_SERVER_ERROR", "status": 404,
                "originalError": { "message": "Board 7 not found", "error": "Not Found", "statusCode": 404 } } })
        );
        assert_eq!(
            sent(too_many_attempts()),
            json!({ "message": "Too many attempts. Please wait a minute and try again.",
                "extensions": { "code": "INTERNAL_SERVER_ERROR" } })
        );
    }
}
