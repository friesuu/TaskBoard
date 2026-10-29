//! The task board's backend in Rust, taking over from the NestJS one in ../backend one part at a time.
//! For now it's the front door: the app and the Claude runner talk to Rust (port 3000), Rust answers the
//! GraphQL operations that have moved here (routing.rs), and passes every other request on to NestJS (3001).
//! Both use the same database and the same login secret, so a login made by one works on the other.

// Each `mod` line brings in one file of src/ (`mod auth;` = src/auth.rs). A file only sees what another
// file marks `pub`.
mod account;
mod auth;
mod bad_requests;
mod boards;
mod config;
mod cookies;
mod dates;
mod errors;
mod graphql;
mod iso8601;
mod labels;
mod passwords;
mod proxy;
mod routing;
mod scalars;
mod tasks;
mod throttle;
mod users;
mod validate;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use axum::http::{HeaderValue, Method};
use axum::routing::post;
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::{AllowHeaders, CorsLayer};

use crate::config::Config;

/// What every request handler can use. axum gives each request its own copy (`Clone`), which is cheap:
/// each field is only a handle to one shared thing (Arc = shared and read-only; the schema and the client
/// work the same way inside).
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub schema: graphql::AppSchema,
    pub http: reqwest::Client,
}

// `async fn main` needs a runtime to run async code on; #[tokio::main] starts one
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // A missing or wrong setting stops it here, with a sentence saying which one
    let config = Config::from_env().unwrap_or_else(|problem| {
        eprintln!("Can't start: {problem}");
        std::process::exit(1);
    });

    // Up to 10 database connections, shared by all requests
    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect_with(config.database())
        .await
        .unwrap_or_else(|err| {
            eprintln!("Can't reach the database: {err}");
            std::process::exit(1);
        });

    // Made once (it takes a moment): logging in with an unknown email is checked against it
    let dummy_hash = passwords::DummyHash::new().await.unwrap_or_else(|err| {
        eprintln!("Can't make the dummy password hash: {err}");
        std::process::exit(1);
    });

    let port = config.port;
    let cors = cors(&config.frontend_url);
    let config = Arc::new(config);
    let state = AppState {
        schema: graphql::schema(db, config.clone(), dummy_hash),
        http: proxy::client(),
        config,
    };

    // POST /graphql is decided in graphql.rs. Everything else goes to NestJS: other methods on /graphql
    // (GET opens GraphiQL), and every other address (file uploads and downloads).
    let app = Router::new()
        .route("/graphql", post(graphql::handler).fallback(proxy::forward))
        .fallback(proxy::forward)
        .layer(cors)
        .with_state(state);

    // [::] = every address, IPv6 and IPv4, like NestJS, so the browser on Windows reaches it as localhost
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0u16; 8], port)))
        .await
        .unwrap_or_else(|err| {
            eprintln!("Can't use port {port}: {err}. Is something else (NestJS?) still using it?");
            std::process::exit(1);
        });
    tracing::info!("Rust backend on port {port}; what hasn't moved yet goes to NestJS");

    // with_connect_info: each request also knows the address it came from (proxy.rs needs it)
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .expect("the server stopped unexpectedly");
}

/// Which website may call this backend with your login cookie: only the frontend, as in NestJS's
/// enableCors (app.setup.ts). The browser asks first ("preflight"); this answers, and marks every response.
fn cors(frontend_url: &str) -> CorsLayer {
    let origin: HeaderValue = frontend_url.parse().expect("FRONTEND_URL must be a plain web address");
    CorsLayer::new()
        .allow_origin(origin)
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::HEAD,
            Method::PUT,
            Method::PATCH,
            Method::POST,
            Method::DELETE,
        ])
        .allow_headers(AllowHeaders::mirror_request())
}
