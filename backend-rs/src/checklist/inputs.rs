//! What the checklist operations take, and their input rules (checklist-item.dto.ts in NestJS). Each input's
//! `checked` does what NestJS's ValidationPipe does: trims the text, checks the rules, and gives it back.

#![allow(dead_code)] // nothing calls this file's functions until you've written resolver.rs: then remove this line

use async_graphql::{InputObject, MaybeUndefined};

use crate::validate;

/// Adding an item: just its text
#[derive(InputObject)]
#[graphql(name = "ChecklistItemInput")]
pub struct ChecklistItemInput {
    pub text: String,
}

impl ChecklistItemInput {
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.text = validate::trimmed("text", &self.text, 200)?.to_string();
        Ok(self)
    }
}

/// Changing an item: new text, ticked/unticked, or both. A null one is refused by the service, as in NestJS.
#[derive(InputObject)]
#[graphql(name = "UpdateChecklistItemInput")]
pub struct UpdateChecklistItemInput {
    pub text: MaybeUndefined<String>,
    pub done: MaybeUndefined<bool>,
}

impl UpdateChecklistItemInput {
    /// Only text that's there is checked (@IsOptional)
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.text = self
            .text
            .map_value(|text| validate::trimmed("text", &text, 200).map(str::to_string))
            .transpose()?;
        Ok(self)
    }
}
