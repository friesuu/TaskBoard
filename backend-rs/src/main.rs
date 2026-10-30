//! The task board's backend in Rust, which took over from the NestJS one in ../backend one part at a time.
//! The app and the Claude runner talk to Rust (port 3000). Until NestJS is turned off (routing::NESTJS_IS_OFF),
//! Rust answers the GraphQL operations that have moved here (routing.rs) and passes every other request on to
//! NestJS (3001); both use the same database and the same login secret. Then Rust answers everything itself.

// Each `mod` line brings in one file of src/ (`mod auth;` = src/auth.rs). A file only sees what another
// file marks `pub`.
mod account;
mod apollo;
mod attachments;
mod auth;
mod bad_requests;
mod boards;
mod chat;
mod checklist;
mod comments;
mod config;
mod cookies;
mod dates;
mod errors;
mod express;
mod graphql;
mod iso8601;
mod labels;
mod migrations;
mod notifications;
mod passwords;
mod proxy;
mod routing;
mod runner;
mod scalars;
mod tasks;
mod throttle;
mod users;
mod validate;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::http::{HeaderValue, Method};
use axum::routing::{any, get, post};
use axum::{Router, ServiceExt, middleware};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::{AllowHeaders, CorsLayer};
use tower_layer::Layer;

use crate::auth::JwtKeys;
use crate::config::Config;
use crate::throttle::RateLimits;

/// What every request handler can use. axum gives each request its own copy (`Clone`), which is cheap:
/// each field is only a handle to one shared thing (Arc = shared and read-only; the schema, the client and
/// the database pool work the same way inside).
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub schema: graphql::AppSchema,
    pub http: reqwest::Client,
    // For the file upload and download, which aren't GraphQL (the GraphQL operations get these from the schema)
    pub db: PgPool,
    pub jwt_keys: Arc<JwtKeys>,
    pub rate_limits: Arc<RateLimits>,
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

    // The tables: any of NestJS's migrations this database hasn't had yet (NestJS ran them when it started)
    match migrations::run(&db).await {
        Ok(0) => {}
        Ok(ran) => tracing::info!("{ran} migrations run"),
        Err(err) => {
            eprintln!("Can't bring the database's tables up to date: {err}");
            std::process::exit(1);
        }
    }

    // Made once (it takes a moment): logging in with an unknown email is checked against it
    let dummy_hash = passwords::DummyHash::new().await.unwrap_or_else(|err| {
        eprintln!("Can't make the dummy password hash: {err}");
        std::process::exit(1);
    });

    let port = config.port;
    let cors = cors(&config.frontend_url);
    let config = Arc::new(config);

    // The clean-up of stored files nobody points at any more: now, then every hour, on its own task (tokio::spawn
    // runs it alongside the server)
    tokio::spawn(attachments::clean_up_regularly(db.clone(), config.upload_dir.clone()));

    let state = AppState {
        schema: graphql::schema(db.clone(), config.clone(), dummy_hash),
        http: proxy::client(),
        jwt_keys: Arc::new(JwtKeys::new(&config.jwt_secret)),
        rate_limits: Arc::new(RateLimits::default()),
        db,
        config,
    };

    // /graphql (every method) is graphql.rs; the file upload and download are attachments/routes.rs. Everything else
    // (other methods on those addresses, and every other address) is express::unknown_address: NestJS until it's
    // turned off, then Express's 404.
    let mut app = Router::new().route("/graphql", any(graphql::handler)).route(
        "/api/tasks/{task_id}/attachments",
        post(attachments::upload).fallback(express::unknown_address),
    );
    // The download only once it has moved (routing::DOWNLOAD_MOVED); until then NestJS answers it
    if routing::DOWNLOAD_MOVED {
        app = app.route(
            "/api/attachments/{id}/download",
            get(attachments::download).fallback(express::unknown_address),
        );
    }
    // CORS answers OPTIONS before the routes
    let app = app.fallback(express::unknown_address).layer(cors).with_state(state);
    // Around the whole app (Router::layer would wrap each route's handlers, inside axum's own parts): Express's
    // headers on every answer, and, before the routes are looked at, the address tidied like Express
    let app = middleware::from_fn(express::headers_like_express).layer(app);
    let app = middleware::from_fn(express::like_express).layer(app);

    // [::] = every address, IPv6 and IPv4, like NestJS, so the browser on Windows reaches it as localhost
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0u16; 8], port)))
        .await
        .unwrap_or_else(|err| {
            eprintln!("Can't use port {port}: {err}. Is something else (NestJS?) still using it?");
            std::process::exit(1);
        });
    if routing::NESTJS_IS_OFF {
        tracing::info!("Rust backend on port {port}");
    } else {
        tracing::info!("Rust backend on port {port}; what hasn't moved yet goes to NestJS");
    }

    // with_connect_info: each request also knows the address it came from (proxy.rs needs it)
    // ServiceExt::into_make_service_with_connect_info: each request also knows the address it came from
    axum::serve(
        listener,
        ServiceExt::<axum::extract::Request>::into_make_service_with_connect_info::<SocketAddr>(app),
    )
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
