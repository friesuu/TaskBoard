//! Tasks: tasks.resolver.ts and tasks.service.ts in NestJS. A task is on one board, in one column (its status),
//! at a position in that column (0 = top). Someone else's task gives the same "Task 7 not found" as one that
//! doesn't exist; someone else's board just has no tasks.

use async_graphql::{Context, Enum, InputObject, MaybeUndefined, Object, SimpleObject};
use chrono::Utc;
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::auth::current_user;
use crate::boards;
use crate::dates::{self, Zone};
use crate::errors::{bad_request, internal, not_found};
use crate::labels::{self, Label};
use crate::scalars::DateTime;
use crate::validate;

/// The board's columns, in order (tasks-status.enum.ts). Prompt Review and AI Review belong to the Claude runner.
/// In the database it's tasks_status_enum, written in lowercase with underscores: PromptReview is 'prompt_review'.
#[derive(Enum, sqlx::Type, Clone, Copy, PartialEq, Eq)]
#[sqlx(type_name = "tasks_status_enum", rename_all = "snake_case")]
pub enum TaskStatus {
    Todo,
    PromptReview,
    InProgress,
    AiReview,
    Done,
}

/// The due date filter: one at a time (task-filter.dto.ts)
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum DueFilter {
    Overdue,  // due before today and not done
    Today,    // due today
    ThisWeek, // due Monday to Sunday of this week
    NoDate,   // no due date
}

/// A task, as the API shows it (type Task in ../backend/src/schema.gql)
#[derive(SimpleObject, sqlx::FromRow)]
pub struct Task {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub due_date: Option<String>, // "2026-10-29"
    pub position: i32,
    pub created_at: DateTime,
    // The Claude runner's part, written by the runner's own operations (still in NestJS)
    pub refined_prompt: Option<String>,
    pub changes_requested: bool,
    pub prompt_approved_at: Option<DateTime>,
    pub ai_branch: Option<String>,
    pub ai_built_at: Option<DateTime>,
    pub ai_checks_passed: Option<bool>,
    pub ai_merge_requested_at: Option<DateTime>,
    pub ai_merged_at: Option<DateTime>,
    pub ai_error: Option<String>,
    pub board_id: i32,
    // Counted by the database in the same query (TASK_COLUMNS)
    pub checklist_total: i32,
    pub checklist_done: i32,
    pub attachment_count: i32,
    // Not a column: filled after the query, by with_labels
    #[sqlx(skip)]
    pub labels: Vec<Label>,
}

/// The columns that fill a Task. The checklist and attachment counts are counted in the same query (the
/// VirtualColumns in task.entity.ts), so showing a board stays one query however many tasks it has.
const TASK_COLUMNS: &str = "tasks.id, tasks.title, tasks.description, tasks.status,
    to_char(tasks.due_date, 'YYYY-MM-DD') AS due_date, tasks.position, tasks.created_at, tasks.refined_prompt,
    tasks.changes_requested, tasks.prompt_approved_at, tasks.ai_branch, tasks.ai_built_at, tasks.ai_checks_passed,
    tasks.ai_merge_requested_at, tasks.ai_merged_at, tasks.ai_error, tasks.board_id,
    (SELECT count(*)::int FROM checklist_items WHERE task_id = tasks.id) AS checklist_total,
    (SELECT count(*)::int FROM checklist_items WHERE task_id = tasks.id AND done) AS checklist_done,
    (SELECT count(*)::int FROM attachments WHERE task_id = tasks.id) AS attachment_count";

/// The profile's numbers, across all of a user's boards
#[derive(SimpleObject, sqlx::FromRow)]
pub struct TaskStats {
    total: i32,
    todo: i32,
    prompt_review: i32,
    in_progress: i32,
    ai_review: i32,
    done: i32,
    overdue: i32,        // due before today and not done
    due_this_week: i32,  // due this week (the user's Monday to Sunday) and not done yet
    done_this_week: i32, // moved into Done this week
}

/// Every filter is optional; the ones that are set are combined (a task must match all of them)
#[derive(InputObject, Default)]
#[graphql(name = "TaskFilterInput")]
pub struct TaskFilterInput {
    q: Option<String>,                 // searches the title, the notes and the checklist items
    label_ids: Option<Vec<i32>>,       // tasks with ANY of these labels
    statuses: Option<Vec<TaskStatus>>, // tasks in any of these columns
    due: Option<DueFilter>,
}

#[derive(InputObject)]
#[graphql(name = "CreateTaskInput")]
pub struct CreateTaskInput {
    board_id: i32,
    title: String,
    description: Option<String>,
    status: MaybeUndefined<TaskStatus>, // left out: To do; null: an error (see create_task)
    due_date: Option<String>,
}

/// Every field can be left out (kept as it is). A null description or due date removes it; a null title or
/// status is refused.
#[derive(InputObject)]
#[graphql(name = "UpdateTaskInput")]
pub struct UpdateTaskInput {
    title: MaybeUndefined<String>,
    description: MaybeUndefined<String>,
    status: MaybeUndefined<TaskStatus>,
    due_date: MaybeUndefined<String>,
}

#[derive(InputObject)]
#[graphql(name = "MoveTaskInput")]
pub struct MoveTaskInput {
    status: TaskStatus, // the column it ends up in (can be the one it's in)
    position: i32,      // where in that column: 0 = top; past the end = at the bottom
}

/// The tasks part of the GraphQL Query type
#[derive(Default)]
pub struct TasksQuery;

#[Object]
impl TasksQuery {
    /// One board's tasks, column by column in order, each with its labels. Someone else's board: no tasks.
    async fn tasks(
        &self,
        ctx: &Context<'_>,
        board_id: i32,
        filter: Option<TaskFilterInput>,
    ) -> async_graphql::Result<Vec<Task>> {
        let user = current_user(ctx).await?;
        let filter = filter.unwrap_or_default();
        let q = filter.q.as_deref().map(validate::js_trim);
        validate::check([
            // q: trimmed, then @IsOptional @IsString @MaxLength(100), bottom up
            q.and_then(|q| validate::at_most("q", q, 100)),
            // labelIds: @IsOptional @IsArray @ArrayMaxSize(50) @IsInt({ each: true }), bottom up
            filter
                .label_ids
                .as_deref()
                .and_then(|ids| validate::at_most_items("labelIds", ids, 50)),
        ])?;

        // QueryBuilder: SQL put together piece by piece. push adds SQL text, push_bind a value ($1, $2...), so a
        // value is never pasted into the SQL itself.
        let mut query =
            QueryBuilder::<Postgres>::new(format!("SELECT {TASK_COLUMNS} FROM tasks WHERE tasks.owner_id = "));
        query
            .push_bind(user.id)
            .push(" AND tasks.board_id = ")
            .push_bind(board_id);

        if let Some(q) = q.filter(|q| !q.is_empty()) {
            // %, _ and \ are special in ILIKE: a \ goes before each, so "50%" searches for "50%"
            let like = format!("%{}%", q.replace('\\', r"\\").replace('%', r"\%").replace('_', r"\_"));
            query
                .push(" AND (tasks.title ILIKE ")
                .push_bind(like.clone())
                .push(" OR tasks.description ILIKE ")
                .push_bind(like.clone())
                .push(
                    " OR EXISTS (SELECT 1 FROM checklist_items item WHERE item.task_id = tasks.id AND item.text ILIKE ",
                )
                .push_bind(like)
                .push("))");
        }
        if let Some(ids) = filter.label_ids.filter(|ids| !ids.is_empty()) {
            // A separate check, not a join: the task still comes back with ALL its labels
            query
                .push(" AND EXISTS (SELECT 1 FROM task_labels link WHERE link.task_id = tasks.id AND link.label_id = ANY(")
                .push_bind(ids)
                .push("))");
        }
        if let Some(statuses) = filter.statuses.filter(|statuses| !statuses.is_empty()) {
            query.push(" AND tasks.status = ANY(").push_bind(statuses).push(")");
        }
        if let Some(due) = filter.due {
            let today = dates::today_in(&Zone::of(user.time_zone.as_deref()), Utc::now());
            match due {
                // The same rule as the red cards
                DueFilter::Overdue => query
                    .push(" AND tasks.due_date < ")
                    .push_bind(today)
                    .push(" AND tasks.status <> 'done'"),
                DueFilter::Today => query.push(" AND tasks.due_date = ").push_bind(today),
                DueFilter::ThisWeek => {
                    let (monday, sunday) = dates::week_of(today);
                    query
                        .push(" AND tasks.due_date BETWEEN ")
                        .push_bind(monday)
                        .push(" AND ")
                        .push_bind(sunday)
                }
                DueFilter::NoDate => query.push(" AND tasks.due_date IS NULL"),
            };
        }
        // created_at and id: for tasks that share a position (e.g. old rows, all 0)
        query.push(" ORDER BY tasks.position, tasks.created_at, tasks.id");

        let db = ctx.data::<PgPool>()?;
        let tasks = query.build_query_as::<Task>().fetch_all(db).await.map_err(internal)?;
        with_labels(db, tasks).await
    }

    /// The profile's numbers, across all your boards. "Today" and "this week" are the user's own.
    async fn task_stats(&self, ctx: &Context<'_>) -> async_graphql::Result<TaskStats> {
        let user = current_user(ctx).await?;
        let today = dates::today_in(&Zone::of(user.time_zone.as_deref()), Utc::now());
        let (monday, sunday) = dates::week_of(today);
        // FILTER: count only the rows that match. completed_at is a moment in time: it's turned into the user's
        // own date before comparing (AT TIME ZONE, with the time zone as the user saved it, as NestJS does).
        sqlx::query_as(
            "SELECT count(*)::int AS total,
                (count(*) FILTER (WHERE status = 'todo'))::int AS todo,
                (count(*) FILTER (WHERE status = 'prompt_review'))::int AS prompt_review,
                (count(*) FILTER (WHERE status = 'in_progress'))::int AS in_progress,
                (count(*) FILTER (WHERE status = 'ai_review'))::int AS ai_review,
                (count(*) FILTER (WHERE status = 'done'))::int AS done,
                (count(*) FILTER (WHERE due_date < $2 AND status <> 'done'))::int AS overdue,
                (count(*) FILTER (WHERE due_date BETWEEN $3 AND $4 AND status <> 'done'))::int AS due_this_week,
                (count(*) FILTER (
                    WHERE status = 'done' AND (completed_at AT TIME ZONE $5)::date BETWEEN $3 AND $4
                ))::int AS done_this_week
             FROM tasks WHERE owner_id = $1",
        )
        .bind(user.id)
        .bind(today)
        .bind(monday)
        .bind(sunday)
        .bind(user.time_zone.as_deref().unwrap_or("UTC"))
        .fetch_one(ctx.data::<PgPool>()?)
        .await
        .map_err(internal)
    }
}

/// The tasks part of the GraphQL Mutation type
#[derive(Default)]
pub struct TasksMutation;

#[Object]
impl TasksMutation {
    /// A new task at the bottom of its column, on one of your boards
    async fn create_task(&self, ctx: &Context<'_>, input: CreateTaskInput) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        let title = validate::js_trim(&input.title);
        check_fields(Some(title), input.description.as_deref(), input.due_date.as_deref())?;

        let db = ctx.data::<PgPool>()?;
        boards::find_owned(db, input.board_id, user.id).await?;
        let status = match input.status {
            MaybeUndefined::Undefined => TaskStatus::Todo,
            // NestJS tries to save the null, and the database refuses it
            MaybeUndefined::Null => return Err(internal("createTask with status null")),
            MaybeUndefined::Value(status) => status,
        };
        let position = next_position(db, input.board_id, status).await.map_err(internal)?;

        // completed_at: now for a task added straight to Done (e.g. by the assistant)
        let id: i32 = sqlx::query_scalar(
            "INSERT INTO tasks (title, description, status, due_date, position, completed_at, owner_id, board_id)
             VALUES ($1, $2, $3, $4::date, $5, CASE WHEN $3 = 'done' THEN now() END, $6, $7) RETURNING id",
        )
        .bind(title)
        .bind(input.description)
        .bind(status)
        .bind(input.due_date)
        .bind(position)
        .bind(user.id)
        .bind(input.board_id)
        .fetch_one(db)
        .await
        .map_err(internal)?;
        find_owned(db, id, user.id).await
    }

    async fn update_task(&self, ctx: &Context<'_>, id: i32, input: UpdateTaskInput) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        let title = input.title.map_value(|title| validate::js_trim(&title).to_string());
        check_fields(
            title.value().map(String::as_str),
            input.description.value().map(String::as_str),
            input.due_date.value().map(String::as_str),
        )?;

        let db = ctx.data::<PgPool>()?;
        let task = find_owned(db, id, user.id).await?;
        if title.is_null() || input.status.is_null() {
            return Err(bad_request("Title and Status cannot be null"));
        }
        // A new column (e.g. from the dropdown) puts the task at the bottom of that column
        let new_status = input.status.take().filter(|&status| status != task.status);
        let position = match new_status {
            Some(status) => Some(next_position(db, task.board_id, status).await.map_err(internal)?),
            None => None,
        };

        // COALESCE($2, title): the new value, or the old one when $2 is NULL (left out). The description and the
        // due date can also be removed, so each comes with a "change it" flag.
        sqlx::query(&format!(
            "UPDATE tasks SET
                title = COALESCE($2, title),
                description = CASE WHEN $3 THEN $4 ELSE description END,
                due_date = CASE WHEN $5 THEN $6::date ELSE due_date END,
                status = COALESCE($7, status),
                position = COALESCE($8, position),
                completed_at = CASE WHEN $7 IS NULL THEN completed_at ELSE {} END
             WHERE id = $1",
            completed_at_for("$7")
        ))
        .bind(id)
        .bind(title.take())
        .bind(!input.description.is_undefined())
        .bind(input.description.take())
        .bind(!input.due_date.is_undefined())
        .bind(input.due_date.take())
        .bind(new_status)
        .bind(position)
        .execute(db)
        .await
        .map_err(internal)?;
        find_owned(db, id, user.id).await
    }

    /// Drag and drop: puts a task at a position in a column of ITS board (the same column or another), and
    /// numbers that column 0, 1, 2... again. All in one transaction, so a half-done renumbering is never saved.
    async fn move_task(&self, ctx: &Context<'_>, id: i32, input: MoveTaskInput) -> async_graphql::Result<Task> {
        let user = current_user(ctx).await?;
        // position: @IsInt @Min(0), bottom up
        validate::check([validate::not_below("position", input.position, 0)])?;

        let db = ctx.data::<PgPool>()?;
        let mut transaction = db.begin().await.map_err(internal)?;
        let found: Option<(TaskStatus, i32)> =
            sqlx::query_as("SELECT status, board_id FROM tasks WHERE id = $1 AND owner_id = $2")
                .bind(id)
                .bind(user.id)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(internal)?;
        let Some((old_status, board_id)) = found else {
            return Err(task_not_found(id));
        };

        // The column it goes to, without it, in its current order; then it goes in at its new place (a position
        // past the end means at the bottom)
        let mut column: Vec<i32> = sqlx::query_scalar(
            "SELECT id FROM tasks WHERE board_id = $1 AND status = $2 AND id <> $3 ORDER BY position, created_at, id",
        )
        .bind(board_id)
        .bind(input.status)
        .bind(id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(internal)?;
        let index = usize::try_from(input.position).unwrap_or(0).min(column.len());
        column.insert(index, id);

        sqlx::query(&format!(
            "UPDATE tasks SET status = $2, completed_at = {} WHERE id = $1",
            completed_at_for("$2")
        ))
        .bind(id)
        .bind(input.status)
        .execute(&mut *transaction)
        .await
        .map_err(internal)?;
        // unnest ... WITH ORDINALITY: the list of ids as rows, each with its place in the list (1, 2, 3...)
        sqlx::query(
            "UPDATE tasks SET position = (ordered.place - 1)::int
             FROM unnest($1::int[]) WITH ORDINALITY AS ordered(id, place) WHERE tasks.id = ordered.id",
        )
        .bind(&column)
        .execute(&mut *transaction)
        .await
        .map_err(internal)?;
        // Close the gap it left in its old column
        if old_status != input.status {
            renumber(&mut transaction, board_id, old_status)
                .await
                .map_err(internal)?;
        }
        transaction.commit().await.map_err(internal)?;

        find_owned(db, id, user.id).await
    }

    async fn delete_task(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        let deleted = sqlx::query("DELETE FROM tasks WHERE id = $1 AND owner_id = $2")
            .bind(id)
            .bind(user.id)
            .execute(ctx.data::<PgPool>()?)
            .await
            .map_err(internal)?;
        if deleted.rows_affected() == 0 {
            return Err(task_not_found(id));
        }
        Ok(true)
    }
}

/// The rules for a task's fields (create-task.dto.ts; update-task.dto.ts has the same ones). None: not sent, or
/// null (@IsOptional: not checked). The messages come in the input type's order: title, description, due date.
fn check_fields(title: Option<&str>, description: Option<&str>, due_date: Option<&str>) -> async_graphql::Result<()> {
    validate::check([
        // title (already trimmed): @IsString @IsNotEmpty @MaxLength(100), bottom up
        title.and_then(|title| validate::at_most("title", title, 100)),
        title.and_then(|title| validate::not_empty("title", title)),
        // description: @IsOptional @IsString @MaxLength(10000), bottom up
        description.and_then(|description| validate::at_most("description", description, 10000)),
        // dueDate: @IsOptional @Matches(YYYY-MM-DD) @IsDateString({ strict: true }), bottom up
        due_date.and_then(|date| validate::iso_date("dueDate", date)),
        due_date.and_then(validate::date_format),
    ])
}

/// When a task was finished, for the profile's "finished this week" (completedAtFor in tasks.service.ts): now
/// when it moves into Done, kept while it stays in Done, removed when it leaves. SQL for an UPDATE whose new status
/// is `new_status`; in an UPDATE, `status` is still the old one.
fn completed_at_for(new_status: &str) -> String {
    format!("CASE WHEN {new_status} <> 'done' THEN NULL WHEN status = 'done' THEN completed_at ELSE now() END")
}

/// One past the last position in a column, so a task added there lands at the bottom
async fn next_position(db: &PgPool, board_id: i32, status: TaskStatus) -> Result<i32, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(MAX(position) + 1, 0) FROM tasks WHERE board_id = $1 AND status = $2")
        .bind(board_id)
        .bind(status)
        .fetch_one(db)
        .await
}

/// Numbers a column 0, 1, 2... in its current order
async fn renumber(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    board_id: i32,
    status: TaskStatus,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE tasks SET position = (ordered.place - 1)::int
         FROM (SELECT id, row_number() OVER (ORDER BY position, created_at, id) AS place
               FROM tasks WHERE board_id = $1 AND status = $2) AS ordered
         WHERE tasks.id = ordered.id",
    )
    .bind(board_id)
    .bind(status)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

/// One of YOUR tasks, with its labels, or "Task 7 not found" (labels.rs asks this too, for setTaskLabels)
pub async fn find_owned(db: &PgPool, id: i32, owner_id: i32) -> async_graphql::Result<Task> {
    let task: Task = sqlx::query_as(&format!(
        "SELECT {TASK_COLUMNS} FROM tasks WHERE tasks.id = $1 AND tasks.owner_id = $2"
    ))
    .bind(id)
    .bind(owner_id)
    .fetch_optional(db)
    .await
    .map_err(internal)?
    .ok_or_else(|| task_not_found(id))?;
    let mut tasks = with_labels(db, vec![task]).await?;
    Ok(tasks.remove(0))
}

/// The tasks, each with its labels, from one more query for all of them together
async fn with_labels(db: &PgPool, mut tasks: Vec<Task>) -> async_graphql::Result<Vec<Task>> {
    let ids: Vec<i32> = tasks.iter().map(|task| task.id).collect();
    let mut labels = labels::of_tasks(db, &ids).await.map_err(internal)?;
    for task in &mut tasks {
        task.labels = labels.remove(&task.id).unwrap_or_default();
    }
    Ok(tasks)
}

fn task_not_found(id: i32) -> async_graphql::Error {
    not_found(&format!("Task {id} not found"))
}
