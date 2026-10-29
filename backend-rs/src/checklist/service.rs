//! The work on checklists (checklist.service.ts in NestJS): plain functions that take the database, the inputs
//! (already checked) and whose checklists they are. No GraphQL in here.
//! An item has no owner of its own: "is this yours?" is answered through its task's owner.

#![allow(dead_code)] // nothing calls this file's functions until you've written resolver.rs: then remove this line

use sqlx::{PgExecutor, PgPool};

use super::inputs::UpdateChecklistItemInput;
use super::types::ChecklistItem;
use crate::errors::{bad_request, internal, not_found};
use crate::tasks;

/// At most this many items on one checklist (MAX_CHECKLIST_ITEMS in checklist.service.ts)
const MAX_CHECKLIST_ITEMS: i64 = 100;

/// A task's checklist, top to bottom. Someone else's task gives "Task 7 not found".
pub async fn find_all(db: &PgPool, task_id: i32, owner_id: i32) -> async_graphql::Result<Vec<ChecklistItem>> {
    tasks::find_owned(db, task_id, owner_id).await?;
    in_order(db, task_id).await
}

/// A new item, at the bottom (`text` is already trimmed and checked)
pub async fn add(db: &PgPool, task_id: i32, owner_id: i32, text: &str) -> async_graphql::Result<ChecklistItem> {
    tasks::find_owned(db, task_id, owner_id).await?;
    let items: i64 = sqlx::query_scalar("SELECT count(*) FROM checklist_items WHERE task_id = $1")
        .bind(task_id)
        .fetch_one(db)
        .await
        .map_err(internal)?;
    if items >= MAX_CHECKLIST_ITEMS {
        return Err(bad_request(&format!(
            "A checklist can have at most {MAX_CHECKLIST_ITEMS} items"
        )));
    }
    sqlx::query_as(
        "INSERT INTO checklist_items (task_id, text, position)
         VALUES ($1, $2, (SELECT COALESCE(MAX(position) + 1, 0) FROM checklist_items WHERE task_id = $1))
         RETURNING id, text, done, position, task_id",
    )
    .bind(task_id)
    .bind(text)
    .fetch_one(db)
    .await
    .map_err(internal)
}

/// Tick/untick and/or rename. A null text or done is refused before anything else, as in NestJS.
pub async fn update(
    db: &PgPool,
    id: i32,
    owner_id: i32,
    input: UpdateChecklistItemInput,
) -> async_graphql::Result<ChecklistItem> {
    if input.text.is_null() || input.done.is_null() {
        return Err(bad_request("text and done cannot be null"));
    }
    let item = find_owned(db, id, owner_id).await?;
    // COALESCE($2, text): the new value, or the old one when $2 is NULL (left out)
    sqlx::query_as(
        "UPDATE checklist_items SET text = COALESCE($2, text), done = COALESCE($3, done) WHERE id = $1
         RETURNING id, text, done, position, task_id",
    )
    .bind(item.id)
    .bind(input.text.take())
    .bind(input.done.take())
    .fetch_one(db)
    .await
    .map_err(internal)
}

/// Puts an item at `position` in its checklist (0 = top; past the end = bottom; below 0 = top) and numbers the
/// checklist 0, 1, 2... again, in one transaction. Gives back the whole checklist in its new order.
pub async fn move_to(db: &PgPool, id: i32, owner_id: i32, position: i32) -> async_graphql::Result<Vec<ChecklistItem>> {
    let mut transaction = db.begin().await.map_err(internal)?;
    let item = find_owned(&mut *transaction, id, owner_id).await?;
    let ids: Vec<i32> = sqlx::query_scalar("SELECT id FROM checklist_items WHERE task_id = $1 ORDER BY position, id")
        .bind(item.task_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(internal)?;

    let new_order = reorder(ids, id, position);

    // unnest ... WITH ORDINALITY: the list of ids as rows, each with its place in the list (1, 2, 3...)
    sqlx::query(
        "UPDATE checklist_items SET position = (ordered.place - 1)::int
         FROM unnest($1::int[]) WITH ORDINALITY AS ordered(id, place) WHERE checklist_items.id = ordered.id",
    )
    .bind(&new_order)
    .execute(&mut *transaction)
    .await
    .map_err(internal)?;
    let items = in_order(&mut *transaction, item.task_id).await?;
    transaction.commit().await.map_err(internal)?;
    Ok(items)
}

// ===================================== YOUR PART (phase 5) =====================================
// Part 1 of 2 (part 2 is resolver.rs). The tests at the bottom say what it must give back: `cargo test
// checklist`. The steps are in ../../README.md.

/// The checklist's item ids in their new order, once `id` has moved to `position`: take it out of the list,
/// then put it back in at `position`. 0 is the top; a position past the end means the bottom, and one below 0
/// the top (NestJS: Math.min(Math.max(position, 0), list.length)).
///
/// Hints:
/// - Taking it out: `ids.into_iter().filter(|&other| other != id).collect()` gives a new Vec without it. (`&other`
///   in the closure: filter hands it a reference to each id, and `&other` unpacks it into a plain i32.) Or
///   look up `Vec::retain`, which does the same to the Vec itself.
/// - Where it goes: `position.max(0)` is at least 0, `.min(list.len())` at most the end. But a Vec's index is a
///   `usize`, and position is an `i32`: `usize::try_from(number)` converts it, and gives a Result, because a
///   negative number has no usize.
/// - `list.insert(index, id)` puts it in, moving the rest down. The Vec has to be `let mut` for that.
#[allow(unused_variables)] // remove this line when you've written it
pub fn reorder(ids: Vec<i32>, id: i32, position: i32) -> Vec<i32> {
    todo!("phase 5, your part: the new order of a checklist")
}
// ================================================================================================

pub async fn remove(db: &PgPool, id: i32, owner_id: i32) -> async_graphql::Result<()> {
    let item = find_owned(db, id, owner_id).await?;
    sqlx::query("DELETE FROM checklist_items WHERE id = $1")
        .bind(item.id)
        .execute(db)
        .await
        .map_err(internal)?;
    Ok(())
}

/// An item on one of YOUR tasks. An item on someone else's task looks exactly like one that doesn't exist.
///
/// `impl PgExecutor<'_>`: anything sqlx can run a query on, so this works both on the pool (`db`) and inside
/// a transaction (`&mut *transaction`), as move_to needs.
async fn find_owned(db: impl PgExecutor<'_>, id: i32, owner_id: i32) -> async_graphql::Result<ChecklistItem> {
    sqlx::query_as(
        "SELECT checklist_items.id, checklist_items.text, checklist_items.done, checklist_items.position,
                checklist_items.task_id
         FROM checklist_items JOIN tasks ON tasks.id = checklist_items.task_id
         WHERE checklist_items.id = $1 AND tasks.owner_id = $2",
    )
    .bind(id)
    .bind(owner_id)
    .fetch_optional(db)
    .await
    .map_err(internal)?
    .ok_or_else(|| not_found(&format!("Checklist item {id} not found")))
}

/// A task's items, top to bottom
async fn in_order(db: impl PgExecutor<'_>, task_id: i32) -> async_graphql::Result<Vec<ChecklistItem>> {
    sqlx::query_as(
        "SELECT id, text, done, position, task_id FROM checklist_items WHERE task_id = $1 ORDER BY position, id",
    )
    .bind(task_id)
    .fetch_all(db)
    .await
    .map_err(internal)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A checklist of four items, with ids 10, 20, 30 and 40, top to bottom
    const LIST: [i32; 4] = [10, 20, 30, 40];

    #[test]
    fn moves_up_and_down() {
        assert_eq!(reorder(LIST.to_vec(), 30, 0), [30, 10, 20, 40]); // to the top
        assert_eq!(reorder(LIST.to_vec(), 10, 2), [20, 30, 10, 40]); // down
        assert_eq!(reorder(LIST.to_vec(), 40, 1), [10, 40, 20, 30]); // up
    }

    #[test]
    fn past_the_end_is_the_bottom() {
        assert_eq!(reorder(LIST.to_vec(), 10, 3), [20, 30, 40, 10]);
        assert_eq!(reorder(LIST.to_vec(), 10, 99), [20, 30, 40, 10]);
    }

    #[test]
    fn below_zero_is_the_top() {
        assert_eq!(reorder(LIST.to_vec(), 30, -5), [30, 10, 20, 40]);
    }

    #[test]
    fn staying_put_changes_nothing() {
        assert_eq!(reorder(LIST.to_vec(), 20, 1), LIST);
        assert_eq!(reorder(vec![10], 10, 0), [10]);
    }
}
