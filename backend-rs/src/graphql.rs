//! POST /graphql. A request is answered here when every top-level field in it has moved to Rust (routing.rs),
//! and passed on to NestJS unchanged otherwise.

use std::net::SocketAddr;
use std::sync::Arc;

use async_graphql::{EmptySubscription, MergedObject, Schema, Value};
use axum::Json;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, Method, Uri};
use axum::response::{IntoResponse, Response};
use sqlx::PgPool;

use crate::account::AccountMutation;
use crate::auth::{AuthMutation, ClientAddress, JwtKeys, login_cookie};
use crate::boards::{BoardsMutation, BoardsQuery};
use crate::config::Config;
use crate::labels::{LabelsMutation, LabelsQuery};
use crate::passwords::DummyHash;
use crate::routing::{MOVED, rust_answers};
use crate::tasks::{TasksMutation, TasksQuery};
use crate::throttle::{RateLimits, client_address};
use crate::users::UsersQuery;
use crate::{AppState, bad_requests, proxy};

/// The Query and Mutation types. Each module adds its part here as it moves (MergedObject joins the parts
/// into one type).
#[derive(MergedObject, Default)]
pub struct Query(UsersQuery, BoardsQuery, LabelsQuery, TasksQuery);

#[derive(MergedObject, Default)]
pub struct Mutation(
    AuthMutation,
    AccountMutation,
    BoardsMutation,
    LabelsMutation,
    TasksMutation,
);

pub type AppSchema = Schema<Query, Mutation, EmptySubscription>;

/// The schema, with what every resolver can reach (ctx.data): the database, the settings, the keys for the
/// login token, the dummy password hash and the rate limits' counts
pub fn schema(db: PgPool, config: Arc<Config>, dummy_hash: DummyHash) -> AppSchema {
    Schema::build(Query::default(), Mutation::default(), EmptySubscription)
        .data(JwtKeys::new(&config.jwt_secret))
        .data(db)
        .data(config)
        .data(dummy_hash)
        .data(RateLimits::default())
        .finish()
}

/// axum gives a handler what its arguments ask for ("extractors"): the shared state, who sent the request,
/// its method, address and headers, and the whole body (`Bytes`, last: reading it uses the request up).
pub async fn handler(
    State(app): State<AppState>,
    ConnectInfo(sender): ConnectInfo<SocketAddr>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // Not one plain GraphQL request (e.g. a batch, or not JSON): NestJS answers it, as before
    let answer_here = match serde_json::from_slice::<async_graphql::Request>(&body) {
        Ok(request) if rust_answers(&request.query, request.operation_name.as_deref(), &MOVED) => Some(request),
        _ => None,
    };
    let Some(request) = answer_here else {
        return proxy::pass_on(&app, sender, &method, &uri, &headers, body.into()).await;
    };

    // A required variable that's missing or null: refused before anything runs, even the login check
    if let Some(refused) = bad_requests::missing_variables(&request) {
        return refused;
    }
    // Kept for bad_requests::refused: `execute` uses the request up
    let (query, operation_name) = (request.query.clone(), request.operation_name.clone());

    // Two things go along with this one request, for the resolvers: the login cookie (auth::current_user) and
    // who sent it (the rate limits)
    let request = request
        .data(login_cookie(&headers))
        .data(ClientAddress(client_address(sender.ip(), &headers)));
    let mut response = app.schema.execute(request).await;

    // The request itself was wrong (e.g. an unknown field, or a variable that doesn't fit its type): nothing
    // ran. Errors from a resolver have a path (which field), and come with HTTP 200.
    if response.data == Value::Null
        && !response.errors.is_empty()
        && response.errors.iter().all(|error| error.path.is_empty())
    {
        return bad_requests::refused(response.errors, &query, operation_name.as_deref());
    }

    // Headers the resolvers added (the login cookie's Set-Cookie) go on the HTTP answer
    let extra_headers = std::mem::take(&mut response.http_headers);
    let mut answer = Json(response).into_response();
    answer.headers_mut().extend(extra_headers);
    answer
}
