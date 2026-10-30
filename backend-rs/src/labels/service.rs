//! The work on labels (labels.service.ts in NestJS): plain functions that take the database, the inputs (already
//! checked) and whose labels they are. No GraphQL in here, so other parts of the backend can use them too, as
//! NestJS's chat assistant uses LabelsService.

use std::collections::HashMap;

use async_graphql::MaybeUndefined;
use sqlx::PgPool;

use super::inputs::{LabelInput, UpdateLabelInput};
use super::types::Label;
use crate::boards;
use crate::errors::{bad_request, conflict, internal, not_found};
use crate::tasks::{self, Task};
use crate::users::is_duplicate;

/// At most this many labels on one board (MAX_LABELS_PER_BOARD in labels.service.ts)
const MAX_LABELS_PER_BOARD: i64 = 50;

/// A board's labels, A to Z (and by id for two names that sort the same). (Your part in phase 3.)
pub async fn find_all(db: &PgPool, board_id: i32) -> Result<Vec<Label>, sqlx::Error> {
    sqlx::query_as::<_, Label>("SELECT id, name, color, board_id FROM labels WHERE board_id = $1 ORDER BY name, id")
        .bind(board_id)
        .fetch_all(db)
        .await
}

/// One field of updateLabel's input. GraphQL can leave a field out, send it as null, or send a value, and
/// MaybeUndefined has one variant for each: Undefined, Null, Value(the value).
/// Gives back Ok(None) when it was left out (keep what the label has), Ok(Some(value)) to change it, and an
/// error for null, as NestJS does: bad_request("name and color cannot be null"). (Your part in phase 3.)
///
/// `<T>`: works for any type of field (the name is a String, the colour a LabelColor).
fn change<T>(field: MaybeUndefined<T>) -> async_graphql::Result<Option<T>> {
    match field {
        MaybeUndefined::Undefined => Ok(None),
        MaybeUndefined::Null => Err(bad_request("name and color cannot be null")),
        MaybeUndefined::Value(value) => Ok(Some(value)),
    }
}

/// A board's labels, for its owner only: someone else's board is "Board 7 not found" (findAll in labels.service.ts)
pub async fn of_board(db: &PgPool, board_id: i32, owner_id: i32) -> async_graphql::Result<Vec<Label>> {
    boards::find_owned(db, board_id, owner_id).await?;
    find_all(db, board_id).await.map_err(internal)
}

pub async fn create(db: &PgPool, board_id: i32, input: LabelInput, owner_id: i32) -> async_graphql::Result<Label> {
    boards::find_owned(db, board_id, owner_id).await?;
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
    check_name_free(db, board_id, &input.name).await?;

    sqlx::query_as("INSERT INTO labels (name, color, board_id) VALUES ($1, $2, $3) RETURNING id, name, color, board_id")
        .bind(&input.name)
        .bind(input.color)
        .bind(board_id)
        .fetch_one(db)
        .await
        .map_err(|err| name_taken_or_internal(err, &input.name))
}

/// Rename and/or recolour. Tasks with the label show the change straight away (they only point at it).
pub async fn update(db: &PgPool, id: i32, input: UpdateLabelInput, owner_id: i32) -> async_graphql::Result<Label> {
    let name = change(input.name)?;
    let color = change(input.color)?;

    let label = find_owned(db, id, owner_id).await?;
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
pub async fn remove(db: &PgPool, id: i32, owner_id: i32) -> async_graphql::Result<()> {
    let label = find_owned(db, id, owner_id).await?;
    sqlx::query("DELETE FROM labels WHERE id = $1")
        .bind(label.id)
        .execute(db)
        .await
        .map_err(internal)?;
    Ok(())
}

/// Replaces a task's labels ([] removes them all). Every label must be on the task's own board, so a task can
/// never get a label from another board, or another user. Gives back the task with its new labels.
pub async fn set_task_labels(
    db: &PgPool,
    task_id: i32,
    label_ids: Vec<i32>,
    owner_id: i32,
) -> async_graphql::Result<Task> {
    let task = tasks::find_owned(db, task_id, owner_id).await?;
    // The same label twice counts once
    let mut ids = label_ids;
    ids.sort_unstable();
    ids.dedup();
    let on_the_board: i64 = sqlx::query_scalar("SELECT count(*) FROM labels WHERE id = ANY($1) AND board_id = $2")
        .bind(&ids)
        .bind(task.board_id)
        .fetch_one(db)
        .await
        .map_err(internal)?;
    if on_the_board != ids.len() as i64 {
        return Err(not_found("Label not found on this board"));
    }

    // The links live in task_labels, one row per task and label: the old ones out, the new ones in, together
    let mut transaction = db.begin().await.map_err(internal)?;
    sqlx::query("DELETE FROM task_labels WHERE task_id = $1")
        .bind(task_id)
        .execute(&mut *transaction)
        .await
        .map_err(internal)?;
    sqlx::query("INSERT INTO task_labels (task_id, label_id) SELECT $1, unnest($2::int[])")
        .bind(task_id)
        .bind(&ids)
        .execute(&mut *transaction)
        .await
        .map_err(internal)?;
    transaction.commit().await.map_err(internal)?;

    tasks::find_owned(db, task_id, owner_id).await
}

/// The labels of these tasks, by task id. Each task's labels are A to Z the way NestJS sorts them: with
/// JavaScript's localeCompare. The database's own order isn't the same (Windows' "English_Malaysia" here, which
/// puts "-x" before "_x" and emoji last); its ICU collation "und-x-icu" follows the same rules as JavaScript.
pub async fn of_tasks(db: &PgPool, task_ids: &[i32]) -> Result<HashMap<i32, Vec<Label>>, sqlx::Error> {
    /// One row: a label, and the task it's on
    #[derive(sqlx::FromRow)]
    struct OnTask {
        task_id: i32,
        #[sqlx(flatten)]
        label: Label,
    }

    let rows: Vec<OnTask> = sqlx::query_as(
        r#"SELECT link.task_id, labels.id, labels.name, labels.color, labels.board_id
           FROM task_labels link JOIN labels ON labels.id = link.label_id
           WHERE link.task_id = ANY($1)
           ORDER BY labels.name COLLATE "und-x-icu", labels.id"#,
    )
    .bind(task_ids)
    .fetch_all(db)
    .await?;

    let mut by_task: HashMap<i32, Vec<Label>> = HashMap::new();
    for row in rows {
        // entry: the task's list, made empty the first time
        by_task.entry(row.task_id).or_default().push(row.label);
    }
    Ok(by_task)
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
