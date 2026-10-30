//! What NestJS's web server, Express, did around the routes, which Rust now does itself:
//!   - finds a route whatever the capitals and with or without one slash at the end (/GraphQL, /graphql/)
//!   - its headers: "charset=utf-8" on JSON answers, Vary, 204 for an OPTIONS
//!   - answers an address nothing answers with its 404: {"message":"Cannot GET /nope","error":"Not Found",...}

use std::net::SocketAddr;

use axum::Json;
use axum::body::to_bytes;
use axum::extract::{ConnectInfo, OriginalUri, Request, State};
use axum::http::{HeaderValue, Method, StatusCode, Uri, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::routing::NESTJS_IS_OFF;
use crate::{AppState, apollo, proxy};

/// Tidies the address before the routes are looked at, as Express matches them: in small letters, without a slash
/// at the end. The address as it was sent stays with the request (OriginalUri): the 404 shows it, and NestJS gets
/// it unchanged.
pub async fn like_express(mut request: Request, next: Next) -> Response {
    let sent = request.uri().clone();
    let mut tidy = sent.path().to_ascii_lowercase();
    if tidy.len() > 1 && tidy.ends_with('/') {
        tidy.pop();
    }
    if tidy != sent.path() {
        let path_and_query = match sent.query() {
            Some(query) => format!("{tidy}?{query}"),
            None => tidy,
        };
        if let Ok(uri) = Uri::builder().path_and_query(path_and_query).build() {
            *request.uri_mut() = uri;
        }
    }
    request.extensions_mut().insert(OriginalUri(sent));
    next.run(request).await
}

/// The headers Express (with NestJS's CORS settings) sends, where axum and tower-http write them differently:
///   - "application/json; charset=utf-8" on a JSON answer (axum: "application/json")
///   - Vary: Origin, and on an OPTIONS also Access-Control-Request-Headers (tower-http lists three, in small
///     letters)
///   - an OPTIONS (CORS answers every one, before the routes) is 204 No Content, where tower-http says 200
pub async fn headers_like_express(request: Request, next: Next) -> Response {
    let options = request.method() == Method::OPTIONS;
    let mut response = next.run(request).await;
    if options && response.status() == StatusCode::OK {
        *response.status_mut() = StatusCode::NO_CONTENT;
    }
    // axum adds Allow to a 404 for an address that takes other methods; Express never does
    if response.status() == StatusCode::NOT_FOUND {
        response.headers_mut().remove(header::ALLOW);
    }
    let vary = if options {
        "Origin, Access-Control-Request-Headers"
    } else {
        "Origin"
    };
    response
        .headers_mut()
        .insert(header::VARY, HeaderValue::from_static(vary));
    if response
        .headers()
        .get(header::CONTENT_TYPE)
        .is_some_and(|value| value == "application/json")
    {
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json; charset=utf-8"),
        );
    }
    response
}

/// Every request no route takes (main.rs's fallback): NestJS's until it's off, then Express's 404. Before that,
/// Express reads a JSON body (it reads them before looking at the address), so a broken one is refused first.
pub async fn unknown_address(
    State(app): State<AppState>,
    ConnectInfo(sender): ConnectInfo<SocketAddr>,
    OriginalUri(uri): OriginalUri,
    request: Request,
) -> Response {
    if !NESTJS_IS_OFF {
        return proxy::forward(&app, sender, request).await;
    }
    let (parts, body) = request.into_parts();
    if apollo::reads_body(&parts.headers) {
        let Ok(bytes) = to_bytes(body, apollo::BODY_LIMIT + 1).await else {
            return apollo::too_large();
        };
        if let Err(refused) = apollo::read_body(&parts.headers, &bytes) {
            return *refused;
        }
    }
    not_found(&parts.method, &uri)
}

/// Express's answer to an address nothing answers: HTTP 404, and
///   {"message":"Cannot GET /nope?a=b","error":"Not Found","statusCode":404}
/// with the method, and the address as it was sent (with its ?query, written as it came: `uri` prints like that).
pub fn not_found(method: &Method, uri: &Uri) -> Response {
    let body = json!({ "message": format!("Cannot {method} {uri}"), "error": "Not Found", "statusCode": 404 });
    (StatusCode::NOT_FOUND, Json(body)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The answer's status and body, as text
    fn sent(response: Response) -> (StatusCode, String) {
        let status = response.status();
        let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let body = runtime.block_on(async { to_bytes(response.into_body(), usize::MAX).await.unwrap() });
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    // What NestJS answered, byte for byte (target/phase9/nestjs-dev.json)
    #[test]
    fn not_found_like_express() {
        let answer = |method: Method, uri: &str| sent(not_found(&method, &uri.parse().unwrap()));
        assert_eq!(
            answer(Method::GET, "/nope"),
            (
                StatusCode::NOT_FOUND,
                r#"{"message":"Cannot GET /nope","error":"Not Found","statusCode":404}"#.to_string()
            )
        );
        assert_eq!(
            answer(Method::DELETE, "/api/tasks/1").1,
            r#"{"message":"Cannot DELETE /api/tasks/1","error":"Not Found","statusCode":404}"#
        );
        // The address as it was sent: its ?query, and its %-escapes as they came
        assert_eq!(
            answer(Method::GET, "/nope/%E2%9C%93?a=b").1,
            r#"{"message":"Cannot GET /nope/%E2%9C%93?a=b","error":"Not Found","statusCode":404}"#
        );
        assert_eq!(
            answer(Method::POST, "/").1,
            r#"{"message":"Cannot POST /","error":"Not Found","statusCode":404}"#
        );
    }
}
