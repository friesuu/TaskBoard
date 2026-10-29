//! What the task operations take, and their input rules: the DTOs in NestJS (create-task.dto.ts,
//! update-task.dto.ts, move-task.dto.ts, task-filter.dto.ts). In NestJS, the ValidationPipe trims an input and
//! checks its rules before the resolver gets it; here each input's `checked` does that, and gives it back trimmed.

use async_graphql::{Enum, InputObject, MaybeUndefined};

use super::types::TaskStatus;
use crate::validate;

/// The due date filter: one at a time (task-filter.dto.ts)
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum DueFilter {
    Overdue,  // due before today and not done
    Today,    // due today
    ThisWeek, // due Monday to Sunday of this week
    NoDate,   // no due date
}

/// Every filter is optional; the ones that are set are combined (a task must match all of them)
#[derive(InputObject, Default)]
#[graphql(name = "TaskFilterInput")]
pub struct TaskFilterInput {
    pub q: Option<String>,                 // searches the title, the notes and the checklist items
    pub label_ids: Option<Vec<i32>>,       // tasks with ANY of these labels
    pub statuses: Option<Vec<TaskStatus>>, // tasks in any of these columns
    pub due: Option<DueFilter>,
}

impl TaskFilterInput {
    /// The search trimmed, then the rules
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.q = self.q.map(|q| validate::js_trim(&q).to_string());
        validate::check([
            // q: @IsOptional @IsString @MaxLength(100), bottom up
            self.q.as_deref().and_then(|q| validate::at_most("q", q, 100)),
            // labelIds: @IsOptional @IsArray @ArrayMaxSize(50) @IsInt({ each: true }), bottom up
            self.label_ids
                .as_deref()
                .and_then(|ids| validate::at_most_items("labelIds", ids, 50)),
        ])?;
        Ok(self)
    }
}

#[derive(InputObject)]
#[graphql(name = "CreateTaskInput")]
pub struct CreateTaskInput {
    pub board_id: i32,
    pub title: String,
    pub description: Option<String>,
    pub status: MaybeUndefined<TaskStatus>, // left out: To do; null: an error (see service::create)
    pub due_date: Option<String>,
}

impl CreateTaskInput {
    /// The title trimmed, then the rules
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.title = validate::js_trim(&self.title).to_string();
        check_fields(Some(&self.title), self.description.as_deref(), self.due_date.as_deref())?;
        Ok(self)
    }
}

/// Every field can be left out (kept as it is). A null description or due date removes it; a null title or
/// status is refused (by service::update, as NestJS's service does).
#[derive(InputObject)]
#[graphql(name = "UpdateTaskInput")]
pub struct UpdateTaskInput {
    pub title: MaybeUndefined<String>,
    pub description: MaybeUndefined<String>,
    pub status: MaybeUndefined<TaskStatus>,
    pub due_date: MaybeUndefined<String>,
}

impl UpdateTaskInput {
    /// The title trimmed (if there is one), then the rules for the fields that were sent
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.title = self.title.map_value(|title| validate::js_trim(&title).to_string());
        check_fields(
            self.title.value().map(String::as_str),
            self.description.value().map(String::as_str),
            self.due_date.value().map(String::as_str),
        )?;
        Ok(self)
    }
}

#[derive(InputObject)]
#[graphql(name = "MoveTaskInput")]
pub struct MoveTaskInput {
    pub status: TaskStatus, // the column it ends up in (can be the one it's in)
    pub position: i32,      // where in that column: 0 = top; past the end = at the bottom
}

impl MoveTaskInput {
    pub fn checked(self) -> async_graphql::Result<Self> {
        // position: @IsInt @Min(0), bottom up
        validate::check([validate::not_below("position", self.position, 0)])?;
        Ok(self)
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
