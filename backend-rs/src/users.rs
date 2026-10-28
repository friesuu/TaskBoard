//! Users: the User type, `me` (the first operation that moved from NestJS to Rust), and the users table's
//! queries for logging in, registering and the account settings (auth.rs and account.rs use them).

use crate::auth;
use async_graphql::{Context, Object, SimpleObject};
use sqlx::PgPool;

/// A user, as the API shows them: the same fields as NestJS's User (see type User in ../backend/src/schema.gql).
/// The derive line writes code for us:
///   SimpleObject: makes this the GraphQL type User; field names become camelCase (time_zone -> timeZone)
///   sqlx::FromRow: fills it from a database row, each field from the column with the same name
#[derive(SimpleObject, sqlx::FromRow)]
pub struct User {
    pub id: i32,
    pub email: String,
    pub time_zone: Option<String>, // Option: may be empty (NULL in the database, null in GraphQL)
    pub display_name: Option<String>,
    /// Goes up by one when the password changes, so older login tokens stop working. Not in the API (skip).
    #[graphql(skip)]
    pub token_version: i32,
}

// ===================================== YOUR PART (phase 1) =====================================
// Two function bodies to write, then switch `me` over to Rust. The steps are in ../README.md.

/// One user by their id, or None when there's no such user.
///
/// Hints:
/// - The columns are id, email, time_zone, display_name and token_version, in the table users.
/// - `sqlx::query_as::<_, User>("SELECT ... WHERE id = $1")` runs SQL and turns each row into a User;
///   `.bind(id)` fills in $1.
/// - `.fetch_optional(db)` gives at most one row as an Option; `.await` waits for the database.
/// - The function returns a Result: Ok(Some(user)), Ok(None), or Err if the database failed.
pub async fn find(db: &PgPool, id: i32) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>("SELECT id, email, time_zone, display_name, token_version FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(db)
        .await
}

/// The users part of the GraphQL Query type. `Default` lets graphql.rs make one with no arguments.
#[derive(Default)]
pub struct UsersQuery;

// #[Object]: each `async fn` here becomes a field of Query, like a @Query() method in a NestJS resolver
#[Object]
impl UsersQuery {
    /// The logged-in user. Without a valid login cookie: Unauthorized (code UNAUTHENTICATED), like NestJS.
    ///
    /// Hint: auth.rs already has a function that finds the logged-in user, or gives exactly that error.
    async fn me(&self, ctx: &Context<'_>) -> async_graphql::Result<User> {
        auth::current_user(ctx).await
    }
}
// ================================================================================================

/// The name of the board every new account starts with (DEFAULT_BOARD_NAME in boards.service.ts)
const FIRST_BOARD_NAME: &str = "My board";

/// A user and their password hash, for checking a password. Not a GraphQL type, so the hash can never be sent.
/// `#[sqlx(flatten)]`: the user's own columns fill `user`, the rest of the row fills the other fields.
#[derive(sqlx::FromRow)]
pub struct UserWithPassword {
    #[sqlx(flatten)]
    pub user: User,
    pub password_hash: String,
}

/// The user with this email (already trimmed and in lowercase, as it's saved), with their password hash
pub async fn find_by_email(db: &PgPool, email: &str) -> Result<Option<UserWithPassword>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id, email, time_zone, display_name, token_version, password_hash FROM users WHERE email = $1",
    )
    .bind(email)
    .fetch_optional(db)
    .await
}

/// The user with this id, with their password hash
pub async fn find_with_password(db: &PgPool, id: i32) -> Result<Option<UserWithPassword>, sqlx::Error> {
    sqlx::query_as("SELECT id, email, time_zone, display_name, token_version, password_hash FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(db)
        .await
}

/// A new user and their first board, saved together: never a user with no board. A transaction does that:
/// both are saved by `commit`, or neither (if anything fails before it, the transaction is dropped and undone).
pub async fn create(db: &PgPool, email: &str, password_hash: &str) -> Result<User, sqlx::Error> {
    let mut transaction = db.begin().await?;
    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2)
         RETURNING id, email, time_zone, display_name, token_version",
    )
    .bind(email)
    .bind(password_hash)
    .fetch_one(&mut *transaction) // `&mut *`: run it inside the transaction
    .await?;
    sqlx::query("INSERT INTO boards (name, owner_id) VALUES ($1, $2)")
        .bind(FIRST_BOARD_NAME)
        .bind(user.id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(user)
}

/// Is this database error "that email is already taken"? (23505: a unique column got a value it already has)
pub fn is_duplicate(error: &sqlx::Error) -> bool {
    error.as_database_error().and_then(|err| err.code()).as_deref() == Some("23505")
}

pub async fn set_time_zone(db: &PgPool, id: i32, time_zone: &str) -> Result<User, sqlx::Error> {
    sqlx::query_as(
        "UPDATE users SET time_zone = $2 WHERE id = $1 RETURNING id, email, time_zone, display_name, token_version",
    )
    .bind(id)
    .bind(time_zone)
    .fetch_one(db)
    .await
}

/// None removes the name (the email is shown again)
pub async fn set_display_name(db: &PgPool, id: i32, display_name: Option<&str>) -> Result<User, sqlx::Error> {
    sqlx::query_as(
        "UPDATE users SET display_name = $2 WHERE id = $1 RETURNING id, email, time_zone, display_name, token_version",
    )
    .bind(id)
    .bind(display_name)
    .fetch_one(db)
    .await
}

/// A new password. The token version goes up with it, so every login token made before now stops working.
pub async fn set_password(db: &PgPool, id: i32, password_hash: &str) -> Result<User, sqlx::Error> {
    sqlx::query_as(
        "UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1
         RETURNING id, email, time_zone, display_name, token_version",
    )
    .bind(id)
    .bind(password_hash)
    .fetch_one(db)
    .await
}

/// Deletes the user and, through the database's ON DELETE CASCADE, everything that belongs to them
pub async fn delete(db: &PgPool, id: i32) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}
