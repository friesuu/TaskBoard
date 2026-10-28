//! Users. For now only `me`, the logged-in user: the first operation that moves from NestJS to Rust.

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
