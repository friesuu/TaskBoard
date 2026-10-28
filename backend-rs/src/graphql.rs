//! POST /graphql. A request is answered here when every top-level field in it has moved to Rust (routing.rs),
//! and passed on to NestJS unchanged otherwise.

use std::net::SocketAddr;

use async_graphql::{EmptyMutation, EmptySubscription, MergedObject, Schema};
use axum::Json;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, Method, Uri};
use axum::response::{IntoResponse, Response};
use sqlx::PgPool;

use crate::auth::{JwtKey, login_cookie};
use crate::routing::{MOVED, rust_answers};
use crate::users::UsersQuery;
use crate::{AppState, proxy};

/// The Query type. Each module adds its part here as it moves (MergedObject joins them into one type).
/// No mutations in Rust yet: EmptyMutation.
#[derive(MergedObject, Default)]
pub struct Query(UsersQuery);

pub type AppSchema = Schema<Query, EmptyMutation, EmptySubscription>;

/// The schema, with what every resolver can reach (ctx.data): the database, and the key for the login cookie
pub fn schema(db: PgPool, jwt_secret: &str) -> AppSchema {
    Schema::build(Query::default(), EmptyMutation, EmptySubscription)
        .data(db)
        .data(JwtKey::new(jwt_secret))
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

    // The login cookie goes along with this one request, for the resolvers (auth::current_user)
    let response = app.schema.execute(request.data(login_cookie(&headers))).await;
    Json(response).into_response() // HTTP 200 with any errors in the body, like NestJS
}
