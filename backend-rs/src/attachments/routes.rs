//! Uploading and downloading files (attachments.controller.ts in NestJS). Files travel through normal web
//! addresses, not GraphQL (GraphQL is awkward with files):
//!   POST /api/tasks/:taskId/attachments    upload one file (form field "file"), at most 10 MB, 30 a minute
//!   GET  /api/attachments/:id/download     download one, always as a download, 120 a minute
//! Each does its checks in NestJS's order, since that decides which error you get: the login (HttpAuthGuard:
//! 401), the rate limit (ThrottlerGuard: 429), reading the form (FileInterceptor: 400 or 413), the id in the
//! address (ParseIntPipe: 400), then the service. Errors are NestJS's JSON: {"message", "error", "statusCode"}.

use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use tokio_util::io::ReaderStream;

use super::service;
use super::upload_form::{self, FormError};
use crate::AppState;
use crate::auth::{login_cookie, user_from_token};
use crate::throttle::client_address;
use crate::users::User;

const UPLOADS_PER_MINUTE: usize = 30;
const DOWNLOADS_PER_MINUTE: usize = 120;

/// Upload one file to one of your tasks. Answers 201 with the attachment (never its storage key).
/// `Result<Response, Refusal>`: axum sends whichever comes back, and `?` stops at the first refusal.
pub async fn upload(
    State(app): State<AppState>,
    ConnectInfo(sender): ConnectInfo<SocketAddr>,
    Path(task_id): Path<String>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, Refusal> {
    let user = logged_in(&app, &headers).await?;
    limit(&app, sender, &headers, "upload", UPLOADS_PER_MINUTE)?;
    let form = upload_form::read(&headers, body).await.map_err(|err| match err {
        FormError::TooLarge => Refusal::new(StatusCode::PAYLOAD_TOO_LARGE, "File too large", "Payload Too Large"),
        FormError::BadRequest(message) => Refusal::new(StatusCode::BAD_REQUEST, &message, "Bad Request"),
    })?;
    let task_id = id_from_address(&task_id)?;

    let attachment = service::upload(&app.db, &app.config.upload_dir, task_id, user.id, form)
        .await
        .map_err(|err| Refusal::from(&err))?;
    Ok(json_answer(StatusCode::CREATED, json!(attachment)))
}

/// Download one of your files: its exact bytes, sent bit by bit. Always as a download (never shown in the
/// browser), and nosniff tells the browser to believe our Content-Type instead of guessing, so a file can never
/// be run as a web page.
pub async fn download(
    State(app): State<AppState>,
    ConnectInfo(sender): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, Refusal> {
    let user = logged_in(&app, &headers).await?;
    limit(&app, sender, &headers, "download", DOWNLOADS_PER_MINUTE)?;
    // From here on, every answer has NestJS's two @Header lines (the 401 and 429 above don't: in NestJS those
    // come from the guards, before them)
    let id = id_from_address(&id).map_err(Refusal::with_download_headers)?;
    let download = service::open_for_download(&app.db, &app.config.upload_dir, id, user.id)
        .await
        .map_err(|err| Refusal::from(&err).with_download_headers())?;

    let attachment = &download.attachment;
    let mut response = match download.file {
        // 64 KB at a time
        Ok(file) => Body::from_stream(ReaderStream::with_capacity(file, 64 * 1024)).into_response(),
        // The row is there but its file isn't (NestJS: 400, with Node's error message as the text)
        Err(err) => {
            let code = match err.kind() {
                std::io::ErrorKind::NotFound => "ENOENT: no such file or directory",
                std::io::ErrorKind::PermissionDenied => "EACCES: permission denied",
                _ => "EIO: i/o error",
            };
            let message = format!("{code}, open '{}'", download.path.display());
            (StatusCode::BAD_REQUEST, message).into_response()
        }
    };
    // Read before headers_mut: that borrows `response` for changing, and no other look at it is allowed meanwhile
    let sending_the_file = response.status() == StatusCode::OK;
    let answer = response.headers_mut();
    answer.insert(CONTENT_TYPE, header(&attachment.mime_type));
    if sending_the_file {
        answer.insert(CONTENT_LENGTH, HeaderValue::from(attachment.size));
    }
    answer.insert(CONTENT_DISPOSITION, header(&content_disposition(&attachment.file_name)));
    add_download_headers(answer);
    Ok(response)
}

// ===================================== YOUR PART (phase 6) =====================================

/// The Content-Disposition line of a download, in the form every browser understands, including non-English
/// names (contentDisposition in attachments.controller.ts):
///   attachment; filename="<ASCII>"; filename*=UTF-8''<the exact name, percent-encoded>
/// - <ASCII>, for old browsers: every character outside " " to "~" becomes "_", and so do " and \.
/// - The exact name, as JavaScript's encodeURIComponent writes it: letters, digits and - _ . ! ~ * ' ( ) stay as
///   they are; every other byte of the name's UTF-8 becomes % and two capital hex digits ("é" is %C3%A9).
///
/// Hints, since a Rust string can be looked at three ways:
/// - `file_name.chars()`: its characters. For <ASCII>, `match` each one: `' '..='~'` (a range) stays, `'"' | '\\'`
///   and everything else become "_". `.collect::<String>()` puts the pieces together again.
/// - One catch: JavaScript counts an emoji as two characters (it's two UTF-16 units), so "😀.png" becomes
///   "__.png" there, with two underscores. `c.len_utf16()` says how many units a character is; `"_".repeat(n)`.
/// - `file_name.bytes()`: its UTF-8 bytes, for the percent-encoding. `format!("%{byte:02X}")` writes a byte as %
///   and two capital hex digits.
/// - `cargo test attachments` runs the tests at the bottom: names NestJS wrote these lines for.
#[allow(unused_variables)] // remove this line when you've written it
pub fn content_disposition(file_name: &str) -> String {
    todo!("phase 6, your part: the Content-Disposition line of a download")
}
// ================================================================================================

/// An error answer: a status and NestJS's JSON body, made into a whole HTTP answer only when it's sent (a
/// Response itself is too big to pass around in every Result: Clippy's result_large_err)
pub struct Refusal {
    status: StatusCode,
    body: Value,
    download_headers: bool,
}

impl Refusal {
    /// NestJS's body for one of its exceptions: {"message": ..., "error": ..., "statusCode": ...}
    fn new(status: StatusCode, message: &str, error: &str) -> Refusal {
        let body = json!({ "message": message, "error": error, "statusCode": status.as_u16() });
        Refusal {
            status,
            body,
            download_headers: false,
        }
    }

    /// NestJS's answer to an error that isn't one of its exceptions
    fn internal() -> Refusal {
        let body = json!({ "statusCode": 500, "message": "Internal server error" });
        Refusal {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            body,
            download_headers: false,
        }
    }

    /// With the download's two extra header lines
    fn with_download_headers(mut self) -> Refusal {
        self.download_headers = true;
        self
    }
}

/// One of our GraphQL errors as an HTTP answer. NestJS sends an exception there as its originalError (the part
/// of the GraphQL error that errors.rs writes for NestJS's shape), with that status; anything else is a 500.
impl From<&async_graphql::Error> for Refusal {
    fn from(error: &async_graphql::Error) -> Refusal {
        let original = error
            .extensions
            .as_ref()
            .and_then(|extensions| extensions.get("originalError"))
            .and_then(|value| serde_json::to_value(value).ok());
        let status = original
            .as_ref()
            .and_then(|value| value["statusCode"].as_u64())
            .and_then(|code| StatusCode::from_u16(code as u16).ok());
        match (original, status) {
            (Some(body), Some(status)) => Refusal {
                status,
                body,
                download_headers: false,
            },
            _ => Refusal::internal(),
        }
    }
}

/// How axum sends a Refusal
impl IntoResponse for Refusal {
    fn into_response(self) -> Response {
        let mut response = json_answer(self.status, self.body);
        if self.download_headers {
            add_download_headers(response.headers_mut());
        }
        response
    }
}

/// The logged-in user (NestJS's HttpAuthGuard): the same login cookie as GraphQL, or a 401
async fn logged_in(app: &AppState, headers: &HeaderMap) -> Result<User, Refusal> {
    let cookie = login_cookie(headers);
    user_from_token(&app.db, &app.jwt_keys, cookie.0.as_deref())
        .await
        .map_err(|err| Refusal::from(&err))
}

/// One more try at `operation` for the sender's address (NestJS's ThrottlerGuard), or a 429
fn limit(
    app: &AppState,
    sender: SocketAddr,
    headers: &HeaderMap,
    operation: &str,
    per_minute: usize,
) -> Result<(), Refusal> {
    let address = client_address(sender.ip(), headers).to_string();
    app.rate_limits
        .check(operation, &address, per_minute)
        .map_err(|err| Refusal {
            status: StatusCode::TOO_MANY_REQUESTS,
            body: json!({ "statusCode": 429, "message": err.message }),
            download_headers: false,
        })
}

/// An id from the address, the way NestJS's ParseIntPipe reads it: only digits (and a - in front), or a 400
fn id_from_address(text: &str) -> Result<i32, Refusal> {
    let digits = text.strip_prefix('-').unwrap_or(text);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        let message = "Validation failed (numeric string is expected)";
        return Err(Refusal::new(StatusCode::BAD_REQUEST, message, "Bad Request"));
    }
    // Digits, but too big for the database's ids: NestJS's query fails, and it answers 500
    text.parse().map_err(|_| Refusal::internal())
}

/// A JSON answer, with the Content-Type NestJS (Express) sends
fn json_answer(status: StatusCode, body: Value) -> Response {
    let mut response = (status, body.to_string()).into_response();
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    response
}

/// The download's @Header lines in attachments.controller.ts
fn add_download_headers(headers: &mut HeaderMap) {
    headers.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
}

/// A header value from text we made ourselves: always plain visible ASCII, so it can't fail; just in case it
/// ever does, an empty value instead of a crash
fn header(text: &str) -> HeaderValue {
    HeaderValue::from_str(text).unwrap_or_else(|_| HeaderValue::from_static(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    // (file name, what NestJS's contentDisposition gives)
    const NESTJS: &[(&str, &str)] = &[
        (
            "photo.png",
            "attachment; filename=\"photo.png\"; filename*=UTF-8''photo.png",
        ),
        (
            "résumé.txt",
            "attachment; filename=\"r_sum_.txt\"; filename*=UTF-8''r%C3%A9sum%C3%A9.txt",
        ),
        (
            "my \"best\" photo.png",
            "attachment; filename=\"my _best_ photo.png\"; filename*=UTF-8''my%20%22best%22%20photo.png",
        ),
        (
            "back\\slash.txt",
            "attachment; filename=\"back_slash.txt\"; filename*=UTF-8''back%5Cslash.txt",
        ),
        (
            "😀.png",
            "attachment; filename=\"__.png\"; filename*=UTF-8''%F0%9F%98%80.png",
        ),
        (
            "50% off (final).pdf",
            "attachment; filename=\"50% off (final).pdf\"; filename*=UTF-8''50%25%20off%20(final).pdf",
        ),
        (
            "it's ~fine*!.txt",
            "attachment; filename=\"it's ~fine*!.txt\"; filename*=UTF-8''it's%20~fine*!.txt",
        ),
        (
            "日本語.pdf",
            "attachment; filename=\"___.pdf\"; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.pdf",
        ),
        (
            "a b+c=d&e.zip",
            "attachment; filename=\"a b+c=d&e.zip\"; filename*=UTF-8''a%20b%2Bc%3Dd%26e.zip",
        ),
    ];

    #[test]
    fn content_disposition_like_nestjs() {
        for &(name, expected) in NESTJS {
            assert_eq!(content_disposition(name), expected, "{name}");
        }
    }

    #[test]
    fn ids_like_parse_int_pipe() {
        assert_eq!(id_from_address("42").ok(), Some(42));
        assert_eq!(id_from_address("-3").ok(), Some(-3));
        assert_eq!(id_from_address("007").ok(), Some(7));
        for bad in ["abc", "1.5", "+5", "", "-", " 5", "5 "] {
            assert_eq!(
                id_from_address(bad).err().map(|r| r.status),
                Some(StatusCode::BAD_REQUEST),
                "{bad:?}"
            );
        }
        assert_eq!(
            id_from_address("99999999999").err().map(|r| r.status),
            Some(StatusCode::INTERNAL_SERVER_ERROR)
        );
    }
}
