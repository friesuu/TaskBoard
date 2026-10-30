//! /graphql. Until NestJS is off (routing::NESTJS_IS_OFF), a POST is answered here when every top-level field in
//! it has moved to Rust (routing.rs), and everything else is passed on to NestJS unchanged. Once NestJS is off,
//! every request to /graphql is answered here, as NestJS's Apollo Server answered it (apollo.rs).

use std::net::SocketAddr;
use std::sync::Arc;

use async_graphql::http::GraphiQLSource;
use async_graphql::parser::parse_query;
use async_graphql::parser::types::{DocumentOperations, ExecutableDocument, OperationDefinition, OperationType};
use async_graphql::{EmptySubscription, MergedObject, PathSegment, Positioned, Schema, Value, Variables};
use axum::Json;
use axum::body::{Bytes, to_bytes};
use axum::extract::{ConnectInfo, OriginalUri, Request, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use sqlx::PgPool;

use crate::account::AccountMutation;
use crate::apollo::{self, Body};
use crate::attachments::{AttachmentsMutation, AttachmentsQuery};
use crate::auth::{AuthMutation, JwtKeys, login_cookie};
use crate::boards::{BoardsMutation, BoardsQuery};
use crate::chat::{ChatMutation, ChatQuery, Claude};
use crate::checklist::{ChecklistMutation, ChecklistQuery};
use crate::comments::{CommentsMutation, CommentsQuery};
use crate::config::Config;
use crate::labels::{LabelsMutation, LabelsQuery};
use crate::notifications::{NotificationsMutation, NotificationsQuery};
use crate::passwords::DummyHash;
use crate::routing::{MOVED, NESTJS_IS_OFF, rust_answers};
use crate::runner::{AiMutation, AiQuery, RunnerMutation, RunnerQuery, bearer_token};
use crate::tasks::{TasksMutation, TasksQuery};
use crate::throttle::{ClientAddress, RateLimits, client_address};
use crate::users::UsersQuery;
use crate::{AppState, bad_requests, proxy};

/// The Query and Mutation types. Each module adds its part here as it moves (MergedObject joins the parts
/// into one type).
#[derive(MergedObject, Default)]
pub struct Query(
    UsersQuery,
    BoardsQuery,
    LabelsQuery,
    TasksQuery,
    ChecklistQuery,
    CommentsQuery,
    NotificationsQuery,
    AttachmentsQuery,
    AiQuery,
    RunnerQuery,
    ChatQuery,
);

#[derive(MergedObject, Default)]
pub struct Mutation(
    AuthMutation,
    AccountMutation,
    BoardsMutation,
    LabelsMutation,
    TasksMutation,
    ChecklistMutation,
    CommentsMutation,
    NotificationsMutation,
    AttachmentsMutation,
    AiMutation,
    RunnerMutation,
    ChatMutation,
);

pub type AppSchema = Schema<Query, Mutation, EmptySubscription>;

/// The schema, with what every resolver can reach (ctx.data): the database, the settings, the keys for the
/// login token, the dummy password hash, the rate limits' counts and the Claude API (for the chat)
pub fn schema(db: PgPool, config: Arc<Config>, dummy_hash: DummyHash) -> AppSchema {
    let mut builder = Schema::build(Query::default(), Mutation::default(), EmptySubscription);
    // No introspection on the real server: it would hand anyone a full map of the API. (graphql.rs refuses it first,
    // in Apollo's words; this makes sure.)
    if config.production {
        builder = builder.disable_introspection();
    }
    builder
        .data(Claude::new(
            &config.anthropic_base_url,
            config.anthropic_api_key.clone(),
        ))
        .data(JwtKeys::new(&config.jwt_secret))
        .data(db)
        .data(config)
        .data(dummy_hash)
        .data(RateLimits::default())
        .finish()
}

/// Every request to /graphql. axum gives a handler what its arguments ask for ("extractors"): the shared state,
/// who sent the request, the address as it was sent (OriginalUri: main.rs tidies it, like Express), and the
/// request itself (last: reading it uses it up).
pub async fn handler(
    State(app): State<AppState>,
    ConnectInfo(sender): ConnectInfo<SocketAddr>,
    OriginalUri(uri): OriginalUri,
    request: Request,
) -> Response {
    let (parts, body) = request.into_parts();
    if !NESTJS_IS_OFF {
        // As before phase 9: a POST whose operation has moved is answered here, everything else by NestJS
        let Ok(bytes) = to_bytes(body, usize::MAX).await else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        return match moved(&parts.method, &bytes) {
            Some(request) => run(&app, sender, &parts.headers, request).await,
            None => proxy::pass_on(&app, sender, &parts.method, &uri, &parts.headers, bytes.into()).await,
        };
    }

    // 1. The body, read as Express reads it (only a JSON or form body, at most 100 KB)
    let bytes = if apollo::reads_body(&parts.headers) {
        match to_bytes(body, apollo::BODY_LIMIT + 1).await {
            Ok(bytes) => bytes,
            Err(_) => return apollo::too_large(),
        }
    } else {
        Bytes::new()
    };
    let body = match apollo::read_body(&parts.headers, &bytes) {
        Ok(body) => body,
        Err(refused) => return *refused,
    };
    // 2. GraphiQL, the in-browser query tool, for a browser while developing
    if parts.method == Method::GET && !app.config.production && apollo::prefers_html(&parts.headers) {
        return Html(GraphiQLSource::build().endpoint("/graphql").finish()).into_response();
    }
    // 3. A request another website could have sent with your login cookie
    if !apollo::csrf_safe(&parts.headers) {
        return apollo::csrf_refusal();
    }
    answer(&app, sender, &parts.method, uri.query(), &parts.headers, body).await
}

/// Steps 4 onwards: the request's fields, its operation, then running it
async fn answer(
    app: &AppState,
    sender: SocketAddr,
    method: &Method,
    query_string: Option<&str>,
    headers: &HeaderMap,
    body: Body,
) -> Response {
    // 4. Its fields, from the address (GET) or the body (POST); a batch or another method is refused
    let fields = match *method {
        Method::GET => apollo::from_get(query_string),
        Method::POST => apollo::from_post(body),
        _ => return apollo::other_method(),
    };
    let fields = match fields {
        Ok(fields) => fields,
        Err(refused) => return *refused,
    };
    // 5. A query, that reads as GraphQL
    let Some(query) = fields.query.filter(|query| !query.is_empty()) else {
        let message = "GraphQL operations must contain a non-empty `query` or a `persistedQuery` extension.";
        return apollo::refusal(StatusCode::BAD_REQUEST, message);
    };
    let document = match parse_query(&query) {
        Ok(document) => document,
        Err(problem) => return bad_requests::parse_failed(problem),
    };
    // 6. No introspection on the real server
    if app.config.production
        && let Some(refused) = bad_requests::introspection_refused(&document)
    {
        return refused;
    }
    // 7. Which operation: the only one, or the one named. GET may only run a query; there are no subscriptions.
    let operation = match operation_to_run(&document, fields.operation_name.as_deref()) {
        Ok(operation) => operation,
        Err(refused) => return *refused,
    };
    if *method == Method::GET && operation.node.ty != OperationType::Query {
        return apollo::not_a_query_over_get(bad_requests::kind_of(operation));
    }
    if operation.node.ty == OperationType::Subscription {
        return bad_requests::no_subscriptions(operation);
    }

    // 8. Run it
    let mut request = async_graphql::Request::new(query);
    if let Some(name) = fields.operation_name {
        request = request.operation_name(name);
    }
    if let Some(variables) = fields.variables {
        request = request.variables(Variables::from_json(serde_json::Value::Object(variables)));
    }
    let response = run(app, sender, headers, request).await;
    // A client that takes no JSON gets Apollo's 406, after it ran (as in Apollo)
    if response.status() == StatusCode::OK && !apollo::accepts_json(headers) {
        return apollo::not_acceptable();
    }
    response
}

/// The operation to run, as graphql-js picks it: the only one when no name is given, or the one named
fn operation_to_run<'a>(
    document: &'a ExecutableDocument,
    name: Option<&str>,
) -> Result<&'a Positioned<OperationDefinition>, apollo::Refused> {
    let found = match (&document.operations, name) {
        (DocumentOperations::Single(operation), None) => Some(operation),
        (DocumentOperations::Single(_), Some(_)) => None, // an operation without a name isn't "named" anything
        (DocumentOperations::Multiple(operations), Some(name)) => operations.get(name),
        (DocumentOperations::Multiple(operations), None) if operations.len() == 1 => operations.values().next(),
        (DocumentOperations::Multiple(_), None) => None,
    };
    found.ok_or_else(|| Box::new(bad_requests::unclear_operation(name)))
}

/// Until NestJS is off: the request, if it's a POST of one GraphQL request whose fields have all moved to Rust
fn moved(method: &Method, body: &[u8]) -> Option<async_graphql::Request> {
    if *method != Method::POST {
        return None;
    }
    let request: async_graphql::Request = serde_json::from_slice(body).ok()?;
    rust_answers(&request.query, request.operation_name.as_deref(), &MOVED).then_some(request)
}

/// Runs one GraphQL request, with what goes along with it for the resolvers
async fn run(app: &AppState, sender: SocketAddr, headers: &HeaderMap, request: async_graphql::Request) -> Response {
    // A required variable that's missing or null: refused before anything runs, even the login check
    if let Some(refused) = bad_requests::missing_variables(&request) {
        return refused;
    }
    // Kept for bad_requests::refused: `execute` uses the request up
    let (query, operation_name) = (request.query.clone(), request.operation_name.clone());

    // Three things go along with this one request, for the resolvers: the login cookie (auth::current_user), the
    // runner's token (runner::tokens::runner_user), and who sent it (the rate limits)
    let request = request
        .data(login_cookie(headers))
        .data(bearer_token(headers))
        .data(ClientAddress(client_address(sender.ip(), headers)));
    let mut response = app.schema.execute(request).await;

    // The request itself was wrong (e.g. an unknown field, or a variable that doesn't fit its type): nothing
    // ran. Errors from a resolver have a path (which field), and come with HTTP 200.
    if response.data == Value::Null
        && !response.errors.is_empty()
        && response.errors.iter().all(|error| error.path.is_empty())
    {
        return bad_requests::refused(response.errors, &query, operation_name.as_deref());
    }

    // GraphQL's rule (and NestJS's): a field that can't be null and failed makes the object around it null; at the
    // top, `data`. async-graphql leaves the failed field out instead. Every top-level field can't be null except
    // runnerToken and runnerNextJob, which answer null themselves (errors::null_on_error): so a top-level field
    // with an error, and missing from `data`, is one of those that can't be null.
    if let Value::Object(fields) = &response.data
        && response.errors.iter().any(|error| match error.path.as_slice() {
            [PathSegment::Field(name)] => !fields.contains_key(name.as_str()),
            _ => false,
        })
    {
        response.data = Value::Null;
    }

    // Headers the resolvers added (the login cookie's Set-Cookie) go on the HTTP answer
    let extra_headers = std::mem::take(&mut response.http_headers);
    let mut answer = Json(response).into_response();
    answer.headers_mut().extend(extra_headers);
    answer
}

#[cfg(test)]
mod tests {
    use super::*;

    // A name mistyped in MOVED wouldn't fail anything: the operation would just stay with NestJS, which answers
    // it fine. So: MOVED lists exactly the operations Rust's schema has, no more, no fewer.
    #[tokio::test]
    async fn moved_is_exactly_what_rust_has() {
        let schema = Schema::build(Query::default(), Mutation::default(), EmptySubscription).finish();
        let answer = schema
            .execute("{ __schema { queryType { fields { name } } mutationType { fields { name } } } }")
            .await
            .data
            .into_json()
            .unwrap();
        let names = |root: &str| -> Vec<String> {
            let mut names: Vec<String> = answer["__schema"][root]["fields"]
                .as_array()
                .unwrap()
                .iter()
                .map(|field| field["name"].as_str().unwrap().to_string())
                .collect();
            names.sort();
            names
        };
        let sorted = |list: &[&str]| -> Vec<String> {
            let mut list: Vec<String> = list.iter().map(|name| name.to_string()).collect();
            list.sort();
            list
        };
        assert_eq!(names("queryType"), sorted(MOVED.queries));
        assert_eq!(names("mutationType"), sorted(MOVED.mutations));
    }
}
