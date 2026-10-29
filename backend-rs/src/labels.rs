//! Labels, e.g. "Urgent" in orange: labels.resolver.ts and labels.service.ts in NestJS. Labels belong to a
//! board; a task can have several. Giving a task its labels (setTaskLabels) stays in NestJS until tasks move
//! in phase 4, because it answers with a whole Task.

use async_graphql::{Context, Enum, InputObject, MaybeUndefined, Object, SimpleObject};
use sqlx::PgPool;

use crate::auth::current_user;
use crate::boards;
use crate::errors::{bad_request, conflict, internal, not_found};
use crate::users::is_duplicate;
use crate::validate;

/// At most this many labels on one board (MAX_LABELS_PER_BOARD in labels.service.ts)
const MAX_LABELS_PER_BOARD: i64 = 50;

// ===================================== YOUR PART (phase 3) =====================================
// Three pieces: the palette's colours, a `match`, and one SQL query. The steps are in ../README.md;
// `cargo test labels` checks the first two, scripts/e2e.sh all three.

/// The label palette (label-color.enum.ts). No red on purpose: red means "overdue" everywhere in the app.
///
/// The derive line makes it two things at once:
///   Enum: the GraphQL enum LabelColor. Each variant's name becomes its value in capitals: Gray -> GRAY.
///   sqlx::Type: the database's labels_color_enum. rename_all = "lowercase" saves Gray as 'gray'.
/// (Enum needs Clone, Copy, PartialEq and Eq too: a colour can be copied and compared like a number.)
///
/// Step 1: add the other seven colours after Gray, in the API's order (enum LabelColor in
/// ../backend/src/schema.gql). Variants are written like types: Blue, not BLUE or blue.
#[derive(Enum, sqlx::Type, Clone, Copy, PartialEq, Eq)]
#[sqlx(type_name = "labels_color_enum", rename_all = "lowercase")]
pub enum LabelColor {
    Gray,
    Blue,
    Purple,
    Teal,
    Green,
    Yellow,
    Orange,
    Pink,
}

/// One field of updateLabel's input. GraphQL can leave a field out, send it as null, or send a value, and
/// MaybeUndefined has one variant for each: Undefined, Null, Value(the value).
/// Gives back Ok(None) when it was left out (keep what the label has), Ok(Some(value)) to change it, and an
/// error for null, as NestJS does: bad_request("name and color cannot be null").
///
/// `<T>`: works for any type of field (the name is a String, the colour a LabelColor).
///
/// Step 2: write the body as one `match field { ... }` with an arm for each variant:
///   MaybeUndefined::Undefined => ...,
///   MaybeUndefined::Null => ...,
///   MaybeUndefined::Value(value) => ...,   (`value` is the field's value, taken out of the variant)
/// Rust checks that every variant has an arm: leave one out and `cargo build` says which.
fn change<T>(field: MaybeUndefined<T>) -> async_graphql::Result<Option<T>> {
    match field {
        MaybeUndefined::Undefined => Ok(None),
        MaybeUndefined::Null => Err(bad_request("name and color cannot be null")),
        MaybeUndefined::Value(value) => Ok(Some(value)),
    }
}

/// A board's labels, A to Z (and by id for two names that sort the same).
///
/// Step 3: the SQL. It's like `find` in users.rs, which you wrote in phase 1, with two differences:
/// - Several rows: `.fetch_all(db)` gives them as a Vec (a list), where `.fetch_optional` gave at most one.
/// - The order: `ORDER BY name, id`.
///
/// The columns are id, name, color and board_id, in the table labels. sqlx turns each row into a Label,
/// including the colour: 'orange' in the database becomes LabelColor::Orange (once Step 1 is done).
pub async fn find_all(db: &PgPool, board_id: i32) -> Result<Vec<Label>, sqlx::Error> {
    sqlx::query_as::<_, Label>("SELECT id, name, color, board_id FROM labels WHERE board_id = $1 ORDER BY name, id")
        .bind(board_id)
        .fetch_all(db)
        .await
}
// ================================================================================================

/// A label, as the API shows it (type Label in ../backend/src/schema.gql)
#[derive(SimpleObject, sqlx::FromRow)]
pub struct Label {
    pub id: i32,
    pub name: String,
    pub color: LabelColor,
    pub board_id: i32,
}

#[derive(InputObject)]
#[graphql(name = "LabelInput")]
pub struct LabelInput {
    name: String,
    color: LabelColor,
}

/// Renaming and/or recolouring: both can be left out
#[derive(InputObject)]
#[graphql(name = "UpdateLabelInput")]
pub struct UpdateLabelInput {
    name: MaybeUndefined<String>,
    color: MaybeUndefined<LabelColor>,
}

/// The labels part of the GraphQL Query type
#[derive(Default)]
pub struct LabelsQuery;

#[Object]
impl LabelsQuery {
    /// A board's labels, A to Z. Someone else's board: "Board 7 not found".
    async fn labels(&self, ctx: &Context<'_>, board_id: i32) -> async_graphql::Result<Vec<Label>> {
        let user = current_user(ctx).await?;
        let db = ctx.data::<PgPool>()?;
        boards::find_owned(db, board_id, user.id).await?;
        find_all(db, board_id).await.map_err(internal)
    }
}

/// The labels part of the GraphQL Mutation type
#[derive(Default)]
pub struct LabelsMutation;

#[Object]
impl LabelsMutation {
    async fn create_label(&self, ctx: &Context<'_>, board_id: i32, input: LabelInput) -> async_graphql::Result<Label> {
        let user = current_user(ctx).await?;
        let name = validate::name(&input.name, 30)?;

        let db = ctx.data::<PgPool>()?;
        boards::find_owned(db, board_id, user.id).await?;
        let labels: i64 = sqlx::query_scalar("SELECT count(*) FROM labels WHERE board_id = $1")
            .bind(board_id)
            .fetch_one(db)
            .await
            .map_err(internal)?;
        if labels >= MAX_LABELS_PER_BOARD {
            return Err(bad_request(&format!(
                "A board can have at most {MAX_LABELS_PER_BOARD} labels"
            )));
        }
        check_name_free(db, board_id, name).await?;

        sqlx::query_as(
            "INSERT INTO labels (name, color, board_id) VALUES ($1, $2, $3) RETURNING id, name, color, board_id",
        )
        .bind(name)
        .bind(input.color)
        .bind(board_id)
        .fetch_one(db)
        .await
        .map_err(|err| name_taken_or_internal(err, name))
    }

    /// Rename and/or recolour. Tasks with the label show the change straight away (they only point at it).
    async fn update_label(&self, ctx: &Context<'_>, id: i32, input: UpdateLabelInput) -> async_graphql::Result<Label> {
        let user = current_user(ctx).await?;
        // The name rules come first, as NestJS's ValidationPipe runs first. Only a name that's there is
        // checked (@IsOptional): `map_value` checks the value inside, `transpose` turns "a MaybeUndefined with
        // a Result inside" into "a Result with a MaybeUndefined inside", so `?` can stop at a broken rule.
        let name = input
            .name
            .map_value(|name| validate::name(&name, 30).map(str::to_string))
            .transpose()?;
        let name = change(name)?;
        let color = change(input.color)?;

        let db = ctx.data::<PgPool>()?;
        let label = find_owned(db, id, user.id).await?;
        // A new name only needs checking when it's more than a change of capitals ("urgent" -> "Urgent")
        if let Some(name) = &name
            && name.to_lowercase() != label.name.to_lowercase()
        {
            check_name_free(db, label.board_id, name).await?;
        }

        // COALESCE($2, name): the new name, or the old one when $2 is NULL (None: left out)
        sqlx::query_as(
            "UPDATE labels SET name = COALESCE($2, name), color = COALESCE($3, color) WHERE id = $1
             RETURNING id, name, color, board_id",
        )
        .bind(label.id)
        .bind(&name)
        .bind(color)
        .fetch_one(db)
        .await
        .map_err(|err| name_taken_or_internal(err, name.as_deref().unwrap_or_default()))
    }

    /// Also takes the label off every task that had it (the database does that: ON DELETE CASCADE)
    async fn delete_label(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        let db = ctx.data::<PgPool>()?;
        let label = find_owned(db, id, user.id).await?;
        sqlx::query("DELETE FROM labels WHERE id = $1")
            .bind(label.id)
            .execute(db)
            .await
            .map_err(internal)?;
        Ok(true)
    }
}

/// A label on one of YOUR boards. Someone else's label looks exactly like one that doesn't exist.
async fn find_owned(db: &PgPool, id: i32, owner_id: i32) -> async_graphql::Result<Label> {
    sqlx::query_as(
        "SELECT labels.id, labels.name, labels.color, labels.board_id FROM labels
         JOIN boards ON boards.id = labels.board_id
         WHERE labels.id = $1 AND boards.owner_id = $2",
    )
    .bind(id)
    .bind(owner_id)
    .fetch_optional(db)
    .await
    .map_err(internal)?
    .ok_or_else(|| not_found(&format!("Label {id} not found")))
}

/// "Urgent" and "urgent" count as the same name
async fn check_name_free(db: &PgPool, board_id: i32, name: &str) -> async_graphql::Result<()> {
    let taken: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM labels WHERE board_id = $1 AND LOWER(name) = LOWER($2))")
            .bind(board_id)
            .bind(name)
            .fetch_one(db)
            .await
            .map_err(internal)?;
    if taken {
        return Err(name_taken(name));
    }
    Ok(())
}

fn name_taken(name: &str) -> async_graphql::Error {
    conflict(&format!("There is already a label called \"{name}\" on this board"))
}

/// The database refuses two labels with exactly the same name on a board. That only happens when someone
/// saves the same name between check_name_free and the save; NestJS answers that with "Internal server error",
/// Rust with the same message as when check_name_free finds it.
fn name_taken_or_internal(err: sqlx::Error, name: &str) -> async_graphql::Error {
    if is_duplicate(&err) {
        name_taken(name)
    } else {
        internal(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::resolver_utils::EnumType;

    #[test]
    fn the_palette_in_order() {
        // The order is the API's (enum LabelColor in ../backend/src/schema.gql)
        let names: Vec<&str> = LabelColor::items().iter().map(|item| item.name).collect();
        assert_eq!(
            names,
            ["GRAY", "BLUE", "PURPLE", "TEAL", "GREEN", "YELLOW", "ORANGE", "PINK"]
        );
    }

    #[test]
    fn a_field_left_out_is_kept() {
        assert_eq!(change(MaybeUndefined::<String>::Undefined).unwrap(), None);
    }

    #[test]
    fn a_field_with_a_value_is_changed() {
        assert_eq!(
            change(MaybeUndefined::Value("Urgent".to_string())).unwrap(),
            Some("Urgent".to_string())
        );
    }

    #[test]
    fn a_null_field_is_refused() {
        let error = change(MaybeUndefined::<String>::Null).unwrap_err();
        assert_eq!(error.message, "name and color cannot be null");
    }
}
