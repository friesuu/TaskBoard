//! What NestJS's GraphQL server (Apollo Server, with Express in front of it) does with a request to /graphql before
//! running it. Rust does the same now that it answers every request itself (graphql.rs, once NESTJS_IS_OFF):
//!
//!   1. read the body as Express does: JSON (at most 100 KB), or a form; refuse broken JSON
//!   2. GraphiQL, for a browser, while developing
//!   3. refuse a request another website could have sent with your login cookie (CSRF)
//!   4. refuse a batch (a list of operations)
//!   5. take the query, variables and operation name from the address (GET) or the body (POST), with Apollo's
//!      messages for anything wrong; refuse other methods
//!
//! Every refusal here has NestJS's status and shape, and its message, word for word.

use axum::Json;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Map, Value, json};

/// Express's limit for a JSON or form body (body-parser's default, "100kb")
pub const BODY_LIMIT: usize = 100 * 1024;

/// What Apollo says when it refuses a request that could be cross-site request forgery
const CSRF_MESSAGE: &str = "This operation has been blocked as a potential Cross-Site Request Forgery (CSRF). Please either specify a 'content-type' header (with a type that is not one of application/x-www-form-urlencoded, multipart/form-data, text/plain) or provide a non-empty value for one of the following headers: x-apollo-operation-name, apollo-require-preflight\n";

/// The body as Express read it: JSON, a form (as an object), or nothing it reads (another content type, or none)
pub enum Body {
    Json(Value),
    Form(Map<String, Value>),
    Nothing,
}

/// A refusal, as an error. Boxed: a Response is big, and a function whose error is big makes every answer pay for
/// it (clippy's result_large_err). `*refused` takes the Response back out.
pub type Refused = Box<Response>;

/// A request's GraphQL fields, wherever they came from
pub struct Fields {
    pub query: Option<String>,
    pub operation_name: Option<String>,
    pub variables: Option<Map<String, Value>>,
}

/// One of Apollo's own refusals: `{"errors":[{"message":"...","extensions":{"code":"BAD_REQUEST"}}]}`
pub fn refusal(status: StatusCode, message: &str) -> Response {
    let body = json!({ "errors": [{ "message": message, "extensions": { "code": "BAD_REQUEST" } }] });
    (status, Json(body)).into_response()
}

/// A refusal with Allow, for a method Apollo doesn't take (405)
fn method_refusal(allow: &'static str, message: &str) -> Response {
    let mut response = refusal(StatusCode::METHOD_NOT_ALLOWED, message);
    response
        .headers_mut()
        .insert(header::ALLOW, HeaderValue::from_static(allow));
    response
}

/// A request's content type without its parameters, in small letters ("application/json; charset=utf-8" is
/// "application/json"). None when there's none, or when it isn't a content type at all ("???").
fn essence(headers: &HeaderMap) -> Option<Option<String>> {
    let value = headers.get(header::CONTENT_TYPE)?;
    let text = String::from_utf8_lossy(value.as_bytes());
    let essence = text.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    let is_token = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+.^_`|~-".contains(&b))
    };
    let looks_right = essence
        .split_once('/')
        .is_some_and(|(kind, sub)| is_token(kind) && is_token(sub));
    Some(looks_right.then_some(essence))
}

// ======================= 1. The body =======================

/// Does Express read this request's body? Only a JSON or form body; any other is left alone.
pub fn reads_body(headers: &HeaderMap) -> bool {
    matches!(
        essence(headers).flatten().as_deref(),
        Some("application/json" | "application/x-www-form-urlencoded")
    )
}

/// NestJS's answer to a body over BODY_LIMIT
pub fn too_large() -> Response {
    let body = json!({ "statusCode": 413, "message": "request entity too large" });
    (StatusCode::PAYLOAD_TOO_LARGE, Json(body)).into_response()
}

/// The body, read the way Express reads it before anything else looks at the request. Err: NestJS's answer to a
/// body it can't read (too big, or broken JSON).
pub fn read_body(headers: &HeaderMap, bytes: &[u8]) -> Result<Body, Refused> {
    if !reads_body(headers) {
        return Ok(Body::Nothing);
    }
    if bytes.is_empty() {
        return Ok(Body::Json(json!({}))); // no body: an empty object
    }
    if bytes.len() > BODY_LIMIT {
        return Err(Box::new(too_large()));
    }
    let kind = essence(headers).flatten();
    let text = String::from_utf8_lossy(bytes);
    if kind.as_deref() == Some("application/x-www-form-urlencoded") {
        return Ok(Body::Form(read_form(bytes)));
    }
    // Express takes only an object or a list (its "strict" JSON): anything else is refused, in V8's words
    let first = text.trim_start_matches([' ', '\t', '\n', '\r']).chars().next();
    if !matches!(first, Some('{' | '[')) {
        return Err(Box::new(broken_json(&strict_message(&text, first))));
    }
    serde_json::from_str(&text).map(Body::Json).map_err(|error| {
        // Cut off: V8 says it like this. Other mistakes: serde's words (README: "a broken request").
        let message = if error.is_eof() {
            "Unexpected end of JSON input".to_string()
        } else {
            error.to_string()
        };
        Box::new(broken_json(&message))
    })
}

/// NestJS's answer to a body that isn't JSON: 400, `{"message":"...","error":"Bad Request","statusCode":400}`
fn broken_json(message: &str) -> Response {
    let body = json!({ "message": message, "error": "Bad Request", "statusCode": 400 });
    (StatusCode::BAD_REQUEST, Json(body)).into_response()
}

/// The message for a body that doesn't start with { or [, as Express makes it: V8's message for that character
/// ("Unexpected token 'n', \"nope\" is not valid JSON"), which shows the text around it: all of it up to 20
/// characters, else 10 (UTF-16 units, as JavaScript counts) with "..." where it's cut
fn strict_message(text: &str, first: Option<char>) -> String {
    let Some(first) = first else {
        return "Unexpected end of JSON input".to_string(); // only spaces
    };
    let units: Vec<u16> = text.encode_utf16().collect();
    let at = text.find(first).map_or(0, |byte| text[..byte].encode_utf16().count());
    let piece = |from: usize, to: usize| String::from_utf16_lossy(&units[from..to]);
    let shown = if units.len() <= 20 {
        format!("\"{text}\"")
    } else if at < 10 {
        format!("\"{}\"...", piece(0, at + 10))
    } else if at >= units.len() - 10 {
        format!("...\"{}\"", piece(at - 10, units.len()))
    } else {
        format!("...\"{}\"...", piece(at - 10, at + 10))
    };
    format!("Unexpected token '{}', {shown} is not valid JSON", piece(at, at + 1))
}

/// A form body (query=...&variables=...) as an object. A name given twice is a list, as Express's reader makes it.
fn read_form(bytes: &[u8]) -> Map<String, Value> {
    let mut fields = Map::new();
    for (name, value) in form_urlencoded::parse(bytes) {
        let value = Value::String(value.into_owned());
        match fields.get_mut(name.as_ref()) {
            Some(Value::Array(list)) => list.push(value),
            Some(existing) => *existing = Value::Array(vec![existing.take(), value]),
            None => {
                fields.insert(name.into_owned(), value);
            }
        }
    }
    fields
}

// ======================= 2. GraphiQL, and what the client accepts =======================

/// One `accept` entry: "text/html;q=0.9" is ("text", "html", 0.9), at its place in the list
struct Accepted {
    kind: String,
    sub: String,
    q: f64,
    place: usize,
}

fn accepted(headers: &HeaderMap) -> Option<Vec<Accepted>> {
    let value = headers.get(header::ACCEPT)?;
    let text = String::from_utf8_lossy(value.as_bytes()).to_ascii_lowercase();
    let list = text
        .split(',')
        .enumerate()
        .filter_map(|(place, entry)| {
            let mut parts = entry.split(';');
            let (kind, sub) = parts.next()?.trim().split_once('/')?;
            let q = parts
                .filter_map(|param| param.trim().strip_prefix("q="))
                .find_map(|q| q.trim().parse::<f64>().ok())
                .unwrap_or(1.0);
            Some(Accepted {
                kind: kind.trim().to_string(),
                sub: sub.trim().to_string(),
                q,
                place,
            })
        })
        .collect();
    Some(list)
}

/// How much the client wants `kind/sub`, the way Express's Negotiator ranks it: (q, how exactly an entry
/// matches it, that entry's place in the list), from the most exact entry that matches (then the highest q, then
/// the later one). None: not at all (no entry matches, or q=0).
fn rank(list: &[Accepted], kind: &str, sub: &str) -> Option<(f64, u8, usize)> {
    list.iter()
        .filter(|entry| (entry.kind == "*" || entry.kind == kind) && (entry.sub == "*" || entry.sub == sub))
        .map(|entry| {
            let exactness = u8::from(entry.kind == kind) * 4 + u8::from(entry.sub == sub) * 2;
            (entry.q, exactness, entry.place)
        })
        .max_by(|a, b| a.1.cmp(&b.1).then(a.0.total_cmp(&b.0)).then(a.2.cmp(&b.2)))
        .filter(|(q, ..)| *q > 0.0)
}

/// Of these types (in the order the server lists them), the one the client wants most: the highest q, then the
/// most exact match, then the earliest in the client's list, then the earliest in the server's
fn preferred<'a>(list: &[Accepted], types: &[(&'a str, &'a str)]) -> Option<(&'a str, &'a str)> {
    types
        .iter()
        .enumerate()
        .filter_map(|(order, (kind, sub))| rank(list, kind, sub).map(|rank| (rank, order, (*kind, *sub))))
        .min_by(|(a, a_order, _), (b, b_order, _)| {
            b.0.total_cmp(&a.0)
                .then(b.1.cmp(&a.1))
                .then(a.2.cmp(&b.2))
                .then(a_order.cmp(b_order))
        })
        .map(|(_, _, chosen)| chosen)
}

/// Does the client (a browser, typically) want HTML more than JSON? Then a GET gets GraphiQL, while developing.
/// HTML is last of Apollo's list, so it loses every tie it doesn't win by coming first in the client's list.
pub fn prefers_html(headers: &HeaderMap) -> bool {
    let Some(list) = accepted(headers) else {
        return false;
    };
    let types = [
        ("application", "json"),
        ("application", "graphql-response+json"),
        ("text", "html"),
    ];
    preferred(&list, &types) == Some(("text", "html"))
}

/// Does the client take a JSON answer? No accept header: yes. Apollo answers 406 otherwise (after running it).
pub fn accepts_json(headers: &HeaderMap) -> bool {
    let Some(list) = accepted(headers) else {
        return true;
    };
    preferred(
        &list,
        &[("application", "json"), ("application", "graphql-response+json")],
    )
    .is_some()
}

/// Apollo's 406, when the client takes neither JSON nor GraphQL's JSON
pub fn not_acceptable() -> Response {
    refusal(
        StatusCode::NOT_ACCEPTABLE,
        "An 'accept' header was provided for this request which does not accept application/json; charset=utf-8 or application/graphql-response+json; charset=utf-8",
    )
}

// ======================= 3. CSRF =======================

/// Could another website have sent this request with your login cookie? A form on any website can send a POST
/// (or a link a GET) with a "simple" content type, which the browser sends without asking this backend first.
/// Apollo refuses those, unless they carry one of its own headers, which no form can add:
///
///   - a content-type header that isn't one of application/x-www-form-urlencoded, multipart/form-data and
///     text/plain (compared without its parameters and capitals; a content type that doesn't read as one,
///     e.g. "???", counts as not one of them): safe
///   - otherwise (one of those three, or no content-type at all): safe only with a non-empty
///     x-apollo-operation-name or apollo-require-preflight header
///
/// true: safe, go on. false: refused with CSRF_MESSAGE.
pub fn csrf_safe(headers: &HeaderMap) -> bool {
    match essence(headers) {
        // A content type that isn't one a form can send
        Some(None) => return true,
        Some(Some(kind))
            if !matches!(
                kind.as_str(),
                "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain"
            ) =>
        {
            return true;
        }
        _ => {}
    }
    ["x-apollo-operation-name", "apollo-require-preflight"]
        .iter()
        .any(|name| headers.get(*name).is_some_and(|value| !value.is_empty()))
}

/// The refusal for a request csrf_safe says no to
pub fn csrf_refusal() -> Response {
    refusal(StatusCode::BAD_REQUEST, CSRF_MESSAGE)
}

// ======================= 4 and 5. The request's fields =======================

/// The fields of a POST's body, with Apollo's checks in Apollo's order
pub fn from_post(body: Body) -> Result<Fields, Refused> {
    let bad = |message: &str| Box::new(refusal(StatusCode::BAD_REQUEST, message));
    let body = match body {
        Body::Json(Value::Array(_)) => return Err(bad("Operation batching disabled.")),
        Body::Json(Value::Object(fields)) | Body::Form(fields) if !fields.is_empty() => fields,
        _ => {
            return Err(bad(
                "POST body missing, invalid Content-Type, or JSON object has no keys.",
            ));
        }
    };
    // query: a text, or nothing at all (JavaScript's "falsy": null, false, 0, "" count as nothing)
    let query = match body.get("query") {
        Some(Value::String(query)) => Some(query.clone()),
        None | Some(Value::Null | Value::Bool(false)) => None,
        Some(Value::Number(n)) if n.as_f64() == Some(0.0) => None,
        Some(_) => return Err(bad("GraphQL queries must be strings.")),
    };
    for field in ["variables", "extensions"] {
        if body.get(field).is_some_and(Value::is_string) {
            return Err(bad(&format!(
                "`{field}` in a POST body should be provided as an object, not a recursively JSON-encoded string."
            )));
        }
    }
    for field in ["extensions", "variables"] {
        if body
            .get(field)
            .is_some_and(|value| !value.is_null() && !value.is_object())
        {
            return Err(bad(&format!("`{field}` in a POST body must be an object if provided.")));
        }
    }
    if body
        .get("operationName")
        .is_some_and(|value| !value.is_null() && !value.is_string())
    {
        return Err(bad("`operationName` in a POST body must be a string if provided."));
    }
    Ok(Fields {
        query,
        operation_name: body.get("operationName").and_then(Value::as_str).map(str::to_string),
        variables: body.get("variables").and_then(Value::as_object).cloned(),
    })
}

/// The fields of a GET's address: ?query=...&operationName=...&variables={...}
pub fn from_get(query_string: Option<&str>) -> Result<Fields, Refused> {
    let params: Vec<(String, String)> = form_urlencoded::parse(query_string.unwrap_or_default().as_bytes())
        .map(|(name, value)| (name.into_owned(), value.into_owned()))
        .collect();
    let param = |name: &str| {
        params
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    // variables, then extensions: JSON objects in the address
    let mut variables = None;
    for name in ["variables", "extensions"] {
        let Some(text) = param(name) else { continue };
        let bad = |message: String| Box::new(refusal(StatusCode::BAD_REQUEST, &message));
        let parsed: Value = serde_json::from_str(&text)
            .map_err(|_| bad(format!("The {name} search parameter contains invalid JSON.")))?;
        let Value::Object(object) = parsed else {
            return Err(bad(format!(
                "The {name} search parameter should contain a JSON-encoded object."
            )));
        };
        if name == "variables" {
            variables = Some(object);
        }
    }
    Ok(Fields {
        query: param("query"),
        operation_name: param("operationName"),
        variables,
    })
}

/// Apollo takes only GET and POST
pub fn other_method() -> Response {
    method_refusal("GET, POST", "Apollo Server supports only GET/POST requests.")
}

/// A mutation (or subscription) sent with GET: only queries may be (a link could change things otherwise)
pub fn not_a_query_over_get(kind: &str) -> Response {
    method_refusal(
        "POST",
        &format!("GET requests only support query operations, not {kind} operations"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.append(*name, HeaderValue::from_str(value).unwrap());
        }
        map
    }

    // Each case is one NestJS answered in the phase 9 capture (target/phase9/nestjs-dev.json)
    #[test]
    fn csrf_like_apollo() {
        let safe = [
            vec![("content-type", "application/json")],
            vec![("content-type", "application/json; charset=utf-8")],
            vec![("content-type", "application/graphql")],
            vec![("content-type", "???")],
            vec![("content-type", "text/plain"), ("apollo-require-preflight", "true")],
            vec![
                ("content-type", "application/x-www-form-urlencoded"),
                ("apollo-require-preflight", "true"),
            ],
            vec![("x-apollo-operation-name", "X")],
        ];
        for case in safe {
            assert!(csrf_safe(&headers(&case)), "{case:?}");
        }
        let refused = [
            vec![],
            vec![("content-type", "text/plain")],
            vec![("content-type", "Text/Plain; charset=utf-8")],
            vec![("content-type", "application/x-www-form-urlencoded")],
            vec![("content-type", "multipart/form-data; boundary=x")],
            vec![("content-type", "text/plain"), ("apollo-require-preflight", "")],
            vec![("accept", "text/html")],
        ];
        for case in refused {
            assert!(!csrf_safe(&headers(&case)), "{case:?}");
        }
    }

    #[test]
    fn graphiql_for_a_browser() {
        let html = |accept: &str| prefers_html(&headers(&[("accept", accept)]));
        assert!(html("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")); // a browser
        assert!(html("text/html, application/json"));
        assert!(html("text/*"));
        assert!(!html("*/*"));
        assert!(!html("application/json, text/html"));
        assert!(!html("text/html;q=0.5, application/json"));
        assert!(!prefers_html(&HeaderMap::new()));
        assert!(!accepts_json(&headers(&[("accept", "text/html")])));
        assert!(accepts_json(&headers(&[("accept", "*/*")])));
        assert!(accepts_json(&HeaderMap::new()));
    }

    #[test]
    fn broken_json_like_express() {
        assert_eq!(
            strict_message("nope", Some('n')),
            "Unexpected token 'n', \"nope\" is not valid JSON"
        );
        assert_eq!(
            strict_message("this is not json", Some('t')),
            "Unexpected token 't', \"this is not json\" is not valid JSON"
        );
        assert_eq!(
            strict_message("null", Some('n')),
            "Unexpected token 'n', \"null\" is not valid JSON"
        );
        assert_eq!(
            strict_message("\"{ __typename }\"", Some('"')),
            "Unexpected token '\"', \"\"{ __typename }\"\" is not valid JSON"
        );
        // Over 20: the first 10, then "..."
        assert_eq!(
            strict_message("abcdefghijklmnopqrstuvwxyz", Some('a')),
            "Unexpected token 'a', \"abcdefghij\"... is not valid JSON"
        );
        assert_eq!(strict_message("   ", None), "Unexpected end of JSON input");
    }

    #[test]
    fn a_post_body_like_apollo() {
        let message = |body: Value| -> String {
            let Err(response) = from_post(Body::Json(body)) else {
                return "ok".to_string();
            };
            let bytes = futures_body(*response);
            serde_json::from_slice::<Value>(&bytes).unwrap()["errors"][0]["message"]
                .as_str()
                .unwrap()
                .to_string()
        };
        assert_eq!(
            message(json!({})),
            "POST body missing, invalid Content-Type, or JSON object has no keys."
        );
        assert_eq!(message(json!([])), "Operation batching disabled.");
        assert_eq!(message(json!({ "query": 5 })), "GraphQL queries must be strings.");
        assert_eq!(message(json!({ "query": null, "operationName": "X" })), "ok");
        assert_eq!(
            message(json!({ "query": "{ a }", "variables": "nope" })),
            "`variables` in a POST body should be provided as an object, not a recursively JSON-encoded string."
        );
        assert_eq!(
            message(json!({ "query": "{ a }", "variables": [1] })),
            "`variables` in a POST body must be an object if provided."
        );
        assert_eq!(
            message(json!({ "query": "{ a }", "operationName": 5 })),
            "`operationName` in a POST body must be a string if provided."
        );
    }

    /// A response's body, for the tests
    fn futures_body(response: Response) -> Vec<u8> {
        let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
        runtime.block_on(async {
            axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec()
        })
    }
}
