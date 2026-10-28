//! The settings, from environment variables. Locally most of them come from ../backend/.env, the file
//! NestJS reads, so both backends use the same database and the same login secret. A variable that's
//! already set wins over the file: that's how scripts/e2e.sh points both at the test database.

use std::env;
use std::path::{Path, PathBuf};

use sqlx::postgres::PgConnectOptions;

pub struct Config {
    /// RUST_PORT (default 3000): where the app and the Claude runner reach the backend
    pub port: u16,
    /// NESTJS_URL (default http://localhost:3001): the NestJS backend, for everything not moved to Rust yet
    pub nestjs_url: String,
    /// FRONTEND_URL (default http://localhost:5173): the only website allowed to call this with cookies
    pub frontend_url: String,
    /// JWT_SECRET: signs the login cookie's token and checks it, the same secret as NestJS
    pub jwt_secret: String,
    /// NODE_ENV=production (the real server, as for NestJS): the login cookie is only sent over https
    pub secure_cookies: bool,
    /// UPLOAD_DIR (default "uploads"): the folder with the uploaded files, the same one NestJS uses.
    /// A relative path is from the folder of the .env file (../backend), as it is for NestJS.
    pub upload_dir: PathBuf,
    database: PgConnectOptions,
}

impl Config {
    /// The settings, or a sentence saying which one is missing or wrong.
    /// `?` after a call: if it failed, stop here and return its error.
    pub fn from_env() -> Result<Config, String> {
        // ENV_FILE (default ../backend/.env, from the backend-rs folder). No file is fine: on a real server
        // the variables are set directly. dotenvy never overwrites a variable that's already set.
        let env_file = env::var("ENV_FILE").unwrap_or_else(|_| "../backend/.env".to_string());
        let _ = dotenvy::from_path(&env_file);

        // Built piece by piece (not as one postgres://... address), so a password needs no escaping
        let database = PgConnectOptions::new()
            .host(&required("DB_HOST")?)
            .port(port("DB_PORT", 5432)?)
            .username(&required("DB_USERNAME")?)
            .password(&required("DB_PASSWORD")?)
            .database(&required("DB_NAME")?);

        // NestJS runs in ../backend, so its relative paths start there
        let backend_folder = Path::new(&env_file).parent().unwrap_or(Path::new("."));
        let upload_dir = backend_folder.join(optional("UPLOAD_DIR", "uploads")); // an absolute path stays as it is

        Ok(Config {
            port: port("RUST_PORT", 3000)?,
            nestjs_url: optional("NESTJS_URL", "http://localhost:3001"),
            frontend_url: optional("FRONTEND_URL", "http://localhost:5173"),
            jwt_secret: required("JWT_SECRET")?,
            secure_cookies: env::var("NODE_ENV").as_deref() == Ok("production"),
            upload_dir,
            database,
        })
    }

    /// How to reach the database. `&self`: it only reads the settings; `.clone()` hands out a copy.
    pub fn database(&self) -> PgConnectOptions {
        self.database.clone()
    }
}

// `&str` is text we only look at; `String` is text we own and keep (in Config)
fn required(name: &str) -> Result<String, String> {
    env::var(name).map_err(|_| format!("{name} isn't set (locally it comes from ../backend/.env)"))
}

fn optional(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_string())
}

/// A port number (u16: a whole number from 0 to 65535)
fn port(name: &str, default: u16) -> Result<u16, String> {
    match env::var(name) {
        Err(_) => Ok(default),
        Ok(text) => text
            .parse()
            .map_err(|_| format!("{name} must be a port number, not {text:?}")),
    }
}
