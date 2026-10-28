//! Passing a request on to NestJS, and its answer back, for everything that hasn't moved to Rust yet:
//! GraphQL operations, file uploads and downloads, the GraphiQL page. Both ways the body streams through,
//! so a 10 MB file is never held in memory here.

use std::net::{IpAddr, SocketAddr};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};

use crate::AppState;

const X_FORWARDED_FOR: &str = "x-forwarded-for";

/// Headers about one connection only (the HTTP rules say they're never passed on)
const HOP_BY_HOP: [&str; 8] = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

/// The HTTP client for NestJS. It passes NestJS's redirects back instead of following them.
pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("the HTTP client builds with these settings")
}

/// Every request Rust has no route for. `ConnectInfo`: the address the request came from.
pub async fn forward(
    State(app): State<AppState>,
    ConnectInfo(sender): ConnectInfo<SocketAddr>,
    request: Request,
) -> Response {
    let (parts, body) = request.into_parts();
    let body = reqwest::Body::wrap_stream(body.into_data_stream());
    pass_on(&app, sender, &parts.method, &parts.uri, &parts.headers, body).await
}

/// One request to NestJS, unchanged (same method, address, headers and body), and NestJS's answer back
pub async fn pass_on(
    app: &AppState,
    sender: SocketAddr,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: reqwest::Body,
) -> Response {
    let path = uri.path_and_query().map_or("/", |p| p.as_str());
    let mut request = app
        .http
        .request(method.clone(), format!("{}{path}", app.config.nestjs_url))
        .body(body);

    // The headers go along (the login cookie, the runner's token...), except Host (NestJS has its own address),
    // the ones about this connection, and X-Forwarded-For, which goes once, with the sender added
    for (name, value) in headers {
        let name_text = name.as_str(); // header names are always lowercase here
        if name_text != "host" && name_text != X_FORWARDED_FOR && !HOP_BY_HOP.contains(&name_text) {
            request = request.header(name, value);
        }
    }
    request = request.header(X_FORWARDED_FOR, forwarded_for(headers, sender.ip()));

    let answer = match request.send().await {
        Ok(answer) => answer,
        Err(err) => {
            tracing::error!("NestJS didn't answer at {}: {err}", app.config.nestjs_url);
            let message = "The NestJS backend isn't answering. Is it running (NESTJS_URL)?";
            return (StatusCode::BAD_GATEWAY, message).into_response();
        }
    };

    let mut response = Response::builder().status(answer.status());
    for (name, value) in answer.headers() {
        // CORS headers come from Rust's own CORS layer (main.rs): NestJS's would be doubles
        if !HOP_BY_HOP.contains(&name.as_str()) && !name.as_str().starts_with("access-control-") {
            response = response.header(name, value);
        }
    }
    response
        .body(Body::from_stream(answer.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

/// Who really sent a request, for NestJS: the address it came from, added at the end of any X-Forwarded-For
/// it already had. NestJS believes this header only from this computer ('trust proxy' in app.setup.ts) and
/// reads it from the end, so it gets the real address, and anything a sender from another computer made up
/// earlier in the header is ignored. Without it every request would seem to come from 127.0.0.1, and the
/// login limit (5 a minute) would count everyone together.
fn forwarded_for(headers: &HeaderMap, sender: IpAddr) -> String {
    // An IPv4 address arrives as ::ffff:1.2.3.4 (we listen on IPv6 too); to_canonical() gives plain 1.2.3.4
    let sender = sender.to_canonical().to_string();
    // The header can come more than once; together they're one list, oldest first
    let earlier: Vec<&str> = headers
        .get_all(X_FORWARDED_FOR)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect();
    if earlier.is_empty() {
        sender
    } else {
        format!("{}, {sender}", earlier.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(text: &str) -> IpAddr {
        text.parse().unwrap()
    }

    #[test]
    fn the_sender_is_added_at_the_end() {
        assert_eq!(forwarded_for(&HeaderMap::new(), ip("203.0.113.9")), "203.0.113.9");

        // A sender can put anything in the header: their real address still comes last, which NestJS uses
        let mut headers = HeaderMap::new();
        headers.insert(X_FORWARDED_FOR, "198.51.100.1".parse().unwrap());
        assert_eq!(forwarded_for(&headers, ip("203.0.113.9")), "198.51.100.1, 203.0.113.9");

        // Sent twice: one list, in order
        headers.append(X_FORWARDED_FOR, "198.51.100.2".parse().unwrap());
        assert_eq!(
            forwarded_for(&headers, ip("203.0.113.9")),
            "198.51.100.1, 198.51.100.2, 203.0.113.9"
        );
    }

    #[test]
    fn ipv4_addresses_are_written_the_plain_way() {
        assert_eq!(
            forwarded_for(&HeaderMap::new(), ip("::ffff:203.0.113.9")),
            "203.0.113.9"
        );
        assert_eq!(forwarded_for(&HeaderMap::new(), ip("::1")), "::1");
    }
}
