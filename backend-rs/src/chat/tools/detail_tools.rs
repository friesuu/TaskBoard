//! A task's other details: its labels (and the board's labels) and its checklist (detail-tools.ts in NestJS).
//! Labels go by name, as the user says them ("urgent" finds "Urgent"); checklist items by the ids Claude sees in
//! <my_tasks> (c31). Nothing here deletes a label or an item: that stays with the user.

use serde_json::Value;

use super::input::{Input, Text};
use super::{Outcome, Tools, change, message};
use crate::checklist::{self, UpdateChecklistItemInput};
use crate::errors::internal;
use crate::labels::{self, Label, LabelColor, LabelInput, UpdateLabelInput};

const LABEL_NAME: Text = Text {
    trim: true,
    min: Some(1),
    max: Some(30),
    date: false,
};
const ITEM_TEXT: Text = Text {
    trim: true,
    min: Some(1),
    max: Some(200),
    date: false,
};

/// The palette, by the names Claude uses (LabelColor's values in the database)
const COLORS: &[&str] = &["gray", "blue", "purple", "teal", "green", "yellow", "orange", "pink"];

fn color_named(name: &str) -> LabelColor {
    match name {
        "blue" => LabelColor::Blue,
        "purple" => LabelColor::Purple,
        "teal" => LabelColor::Teal,
        "green" => LabelColor::Green,
        "yellow" => LabelColor::Yellow,
        "orange" => LabelColor::Orange,
        "pink" => LabelColor::Pink,
        _ => LabelColor::Gray,
    }
}

/// The board's label with this name, in any capitals. An unknown name says which labels there are, so Claude can
/// pick the right one.
async fn label_named(tools: &Tools<'_>, name: &str) -> Result<Label, String> {
    let labels = labels::find_all(tools.db, tools.board_id)
        .await
        .map_err(|error| internal(error).message)?;
    let wanted = name.trim().to_lowercase();
    if let Some(label) = labels.iter().find(|label| label.name.to_lowercase() == wanted) {
        return Ok(label.clone());
    }
    let names: Vec<String> = labels.iter().map(|label| format!("\"{}\"", label.name)).collect();
    let names = if names.is_empty() {
        "none yet".to_string()
    } else {
        names.join(", ")
    };
    Err(format!("No label called \"{name}\" on this board. Its labels: {names}"))
}

/// Puts labels on a task and/or takes them off. Labels not named stay as they are.
pub async fn change_task_labels(tools: &Tools<'_>, input: &Value) -> Outcome {
    let mut input = Input::new(input)?;
    let id = input.int("id");
    let add = input.optional_texts("add", LABEL_NAME, 10);
    let remove = input.optional_texts("remove", LABEL_NAME, 10);
    input.done()?;

    let task = tools.on_this_board(id.unwrap_or_default()).await?;
    let mut to_add = Vec::new();
    for name in add.unwrap_or_default() {
        to_add.push(label_named(tools, &name).await?.id);
    }
    let mut to_remove = Vec::new();
    for name in remove.unwrap_or_default() {
        to_remove.push(label_named(tools, &name).await?.id);
    }
    // The task's labels, then the new ones, each once, without the ones to take off
    let mut ids: Vec<i32> = Vec::new();
    for label_id in task.labels.iter().map(|label| label.id).chain(to_add) {
        if !to_remove.contains(&label_id) && !ids.contains(&label_id) {
            ids.push(label_id);
        }
    }

    let task = labels::set_task_labels(tools.db, task.id, ids, tools.owner_id)
        .await
        .map_err(message)?;
    let names: Vec<&str> = task.labels.iter().map(|label| label.name.as_str()).collect();
    let now = if names.is_empty() {
        "no labels".to_string()
    } else {
        names.join(", ")
    };
    Ok(format!("Task #{} \"{}\" now has: {now}.", task.id, task.title))
}

/// A new label on this board (on no task yet)
pub async fn create_label(tools: &Tools<'_>, input: &Value) -> Outcome {
    let mut input = Input::new(input)?;
    let name = input.text("name", LABEL_NAME);
    let color = input.one_of("color", COLORS);
    input.done()?;

    let new_label = LabelInput {
        name: name.unwrap_or_default(),
        color: color_named(&color.unwrap_or_default()),
    };
    let label = labels::create(tools.db, tools.board_id, new_label, tools.owner_id)
        .await
        .map_err(message)?;
    Ok(format!(
        "Created the label \"{}\" ({}).",
        label.name,
        label.color.as_str()
    ))
}

/// Renames and/or recolours one of this board's labels: every task with it shows the change
pub async fn update_label(tools: &Tools<'_>, input: &Value) -> Outcome {
    let mut input = Input::new(input)?;
    let name = input.text("name", LABEL_NAME);
    let new_name = input.optional_text("newName", LABEL_NAME);
    let color = input.optional_one_of("color", COLORS);
    input.done()?;

    if new_name.is_none() && color.is_none() {
        return Err("Give a new name or a colour".to_string());
    }
    let label = label_named(tools, &name.unwrap_or_default()).await?;
    let changes = UpdateLabelInput {
        name: change(new_name),
        color: change(color.map(|color| color_named(&color))),
    };
    let label = labels::update(tools.db, label.id, changes, tools.owner_id)
        .await
        .map_err(message)?;
    Ok(format!(
        "The label is now \"{}\" ({}).",
        label.name,
        label.color.as_str()
    ))
}

/// New items at the bottom of a task's checklist, in the order given
pub async fn add_checklist_items(tools: &Tools<'_>, input: &Value) -> Outcome {
    let mut input = Input::new(input)?;
    let id = input.int("id");
    let items = input.texts("items", ITEM_TEXT, 1, 20).unwrap_or_default();
    input.done()?;

    let task = tools.on_this_board(id.unwrap_or_default()).await?;
    for text in &items {
        // One by one, to keep the order
        checklist::add(tools.db, task.id, tools.owner_id, text)
            .await
            .map_err(message)?;
    }
    let what = if items.len() == 1 { "item" } else { "items" };
    Ok(format!(
        "Added {} checklist {what} to task #{} \"{}\".",
        items.len(),
        task.id,
        task.title
    ))
}

/// Ticks or unticks a checklist item, and/or changes its text
pub async fn update_checklist_item(tools: &Tools<'_>, input: &Value) -> Outcome {
    let mut input = Input::new(input)?;
    let item_id = input.int("itemId");
    let done = input.optional_bool("done");
    let text = input.optional_text("text", ITEM_TEXT);
    input.done()?;

    if done.is_none() && text.is_none() {
        return Err("Give done and/or text".to_string());
    }
    let item_id = item_id.unwrap_or_default();
    let Ok(item_id) = i32::try_from(item_id) else {
        return Err(format!("Checklist item {item_id} not found"));
    };
    let item = checklist::find_owned(tools.db, item_id, tools.owner_id)
        .await
        .map_err(message)?;
    tools.on_this_board(i64::from(item.task_id)).await?; // an item on another board's task: "not found on this board"

    let changes = UpdateChecklistItemInput {
        text: change(text),
        done: change(done),
    };
    let item = checklist::update(tools.db, item.id, tools.owner_id, changes)
        .await
        .map_err(message)?;
    let state = if item.done { "ticked" } else { "not ticked" };
    Ok(format!("Checklist item c{} \"{}\" is {state}.", item.id, item.text))
}
