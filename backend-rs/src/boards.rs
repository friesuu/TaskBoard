//! Boards ("Work", "Home"...): the boards module in NestJS (../backend/src/boards). Each board has its own
//! columns, tasks and labels. Someone else's board gives the same "Board 7 not found" as one that doesn't exist,
//! so nobody can find out which board ids are in use.
//!
//! Small enough for one file, in the same four parts as the bigger modules' files (tasks/, labels/, auth/):
//! what the API shows, what the operations take, the GraphQL operations, and the service.

use async_graphql::{Context, InputObject, Object, SimpleObject};
use sqlx::PgPool;

use crate::auth::current_user;
use crate::errors::{bad_request, internal, not_found};
use crate::scalars::DateTime;
use crate::validate;

// ======================= What the API shows (board.entity.ts) =======================

/// A board, as the API shows it (type Board in ../backend/src/schema.gql). Its owner isn't in the API.
#[derive(SimpleObject, sqlx::FromRow)]
pub struct Board {
    pub id: i32,
    pub name: String,
    pub created_at: DateTime,
    // The project the Claude runner works in for this board's AI tasks, e.g. "notes-app". None: no project,
    // the runner leaves the board alone. Only a name: the runner looks it up in its own projects.json.
    pub project: Option<String>,
}

// ======================= What the operations take (board-name.dto.ts, board-project.dto.ts) =======================

#[derive(InputObject)]
#[graphql(name = "BoardNameInput")]
pub struct BoardNameInput {
    name: String,
}

impl BoardNameInput {
    /// The name trimmed, then @IsNotEmpty @MaxLength(100)
    fn checked(mut self) -> async_graphql::Result<Self> {
        self.name = validate::name(&self.name, 100)?.to_string();
        Ok(self)
    }
}

#[derive(InputObject)]
#[graphql(name = "BoardProjectInput")]
pub struct BoardProjectInput {
    project: String,
}

impl BoardProjectInput {
    /// The project trimmed and in lowercase, then the rules
    fn checked(mut self) -> async_graphql::Result<Self> {
        self.project = validate::js_trim(&self.project).to_lowercase();
        validate::check([
            // @IsString @MaxLength(50) @Matches, bottom up
            validate::project_name(&self.project),
            validate::at_most("project", &self.project, 50),
        ])?;
        Ok(self)
    }
}

// ======================= The GraphQL operations (boards.resolver.ts) =======================

/// The boards part of the GraphQL Query type
#[derive(Default)]
pub struct BoardsQuery;

#[Object]
impl BoardsQuery {
    /// Your boards, oldest first (the app opens the first one)
    async fn boards(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<Board>> {
        let user = current_user(ctx).await?;
        find_all(ctx.data::<PgPool>()?, user.id).await
    }
}

/// The boards part of the GraphQL Mutation type
#[derive(Default)]
pub struct BoardsMutation;

#[Object]
impl BoardsMutation {
    async fn create_board(&self, ctx: &Context<'_>, input: BoardNameInput) -> async_graphql::Result<Board> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        create(ctx.data::<PgPool>()?, user.id, &input.name).await
    }

    async fn rename_board(&self, ctx: &Context<'_>, id: i32, input: BoardNameInput) -> async_graphql::Result<Board> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        rename(ctx.data::<PgPool>()?, id, user.id, &input.name).await
    }

    /// Which project the Claude runner works in for this board. Trimmed and made lowercase; "" removes it.
    async fn set_board_project(
        &self,
        ctx: &Context<'_>,
        id: i32,
        input: BoardProjectInput,
    ) -> async_graphql::Result<Board> {
        let user = current_user(ctx).await?;
        let input = input.checked()?;
        set_project(ctx.data::<PgPool>()?, id, user.id, &input.project).await
    }

    /// Deletes the board, with its tasks and labels. You always keep at least one board.
    async fn delete_board(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        remove(ctx.data::<PgPool>()?, id, user.id).await?;
        Ok(true)
    }
}

// ======================= The service (boards.service.ts): the work, with no GraphQL in it =======================

/// Your boards, oldest first
pub async fn find_all(db: &PgPool, owner_id: i32) -> async_graphql::Result<Vec<Board>> {
    sqlx::query_as("SELECT id, name, created_at, project FROM boards WHERE owner_id = $1 ORDER BY created_at, id")
        .bind(owner_id)
        .fetch_all(db)
        .await
        .map_err(internal)
}

/// One of YOUR boards, or "Board 7 not found" (labels and tasks ask this before working on a board)
pub async fn find_owned(db: &PgPool, id: i32, owner_id: i32) -> async_graphql::Result<Board> {
    sqlx::query_as("SELECT id, name, created_at, project FROM boards WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(owner_id)
        .fetch_optional(db)
        .await
        .map_err(internal)?
        .ok_or_else(|| board_not_found(id))
}

pub async fn create(db: &PgPool, owner_id: i32, name: &str) -> async_graphql::Result<Board> {
    sqlx::query_as("INSERT INTO boards (name, owner_id) VALUES ($1, $2) RETURNING id, name, created_at, project")
        .bind(name)
        .bind(owner_id)
        .fetch_one(db)
        .await
        .map_err(internal)
}

pub async fn rename(db: &PgPool, id: i32, owner_id: i32, name: &str) -> async_graphql::Result<Board> {
    // `AND owner_id`: only your own board changes; for any other, no row comes back (not found)
    sqlx::query_as(
        "UPDATE boards SET name = $3 WHERE id = $1 AND owner_id = $2 RETURNING id, name, created_at, project",
    )
    .bind(id)
    .bind(owner_id)
    .bind(name)
    .fetch_optional(db)
    .await
    .map_err(internal)?
    .ok_or_else(|| board_not_found(id))
}

/// `project` is already checked: a plain project name, or "" for no project
pub async fn set_project(db: &PgPool, id: i32, owner_id: i32, project: &str) -> async_graphql::Result<Board> {
    let project = (!project.is_empty()).then_some(project);
    sqlx::query_as(
        "UPDATE boards SET project = $3 WHERE id = $1 AND owner_id = $2 RETURNING id, name, created_at, project",
    )
    .bind(id)
    .bind(owner_id)
    .bind(project)
    .fetch_optional(db)
    .await
    .map_err(internal)?
    .ok_or_else(|| board_not_found(id))
}

/// Deletes the board and, through the database's ON DELETE CASCADE, its tasks and labels. Their uploaded files
/// are left for NestJS's hourly clean-up, as NestJS does. You always keep at least one board.
pub async fn remove(db: &PgPool, id: i32, owner_id: i32) -> async_graphql::Result<()> {
    find_owned(db, id, owner_id).await?;
    let boards: i64 = sqlx::query_scalar("SELECT count(*) FROM boards WHERE owner_id = $1")
        .bind(owner_id)
        .fetch_one(db)
        .await
        .map_err(internal)?;
    if boards <= 1 {
        return Err(bad_request("You can't delete your last board"));
    }
    sqlx::query("DELETE FROM boards WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(owner_id)
        .execute(db)
        .await
        .map_err(internal)?;
    Ok(())
}

fn board_not_found(id: i32) -> async_graphql::Error {
    not_found(&format!("Board {id} not found"))
}
