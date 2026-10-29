//! What the label operations take, and their input rules (label.dto.ts in NestJS). Each input's `checked` does
//! what NestJS's ValidationPipe does: trims the name, checks the rules, and gives the input back trimmed.

use async_graphql::{InputObject, MaybeUndefined};

use super::types::LabelColor;
use crate::validate;

#[derive(InputObject)]
#[graphql(name = "LabelInput")]
pub struct LabelInput {
    pub name: String,
    pub color: LabelColor,
}

impl LabelInput {
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.name = validate::name(&self.name, 30)?.to_string();
        Ok(self)
    }
}

/// Renaming and/or recolouring: both can be left out
#[derive(InputObject)]
#[graphql(name = "UpdateLabelInput")]
pub struct UpdateLabelInput {
    pub name: MaybeUndefined<String>,
    pub color: MaybeUndefined<LabelColor>,
}

impl UpdateLabelInput {
    /// Only a name that's there is checked (@IsOptional): `map_value` checks the value inside, `transpose` turns
    /// "a MaybeUndefined with a Result inside" into "a Result with a MaybeUndefined inside", so `?` can stop at a
    /// broken rule. A null name or colour is refused later, by the service, as in NestJS.
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.name = self
            .name
            .map_value(|name| validate::name(&name, 30).map(str::to_string))
            .transpose()?;
        Ok(self)
    }
}

/// The labels a task should have from now on
#[derive(InputObject)]
#[graphql(name = "SetTaskLabelsInput")]
pub struct SetTaskLabelsInput {
    pub label_ids: Vec<i32>,
}

impl SetTaskLabelsInput {
    pub fn checked(self) -> async_graphql::Result<Self> {
        // labelIds: @IsArray @ArrayMaxSize(10) @IsInt({ each: true }), bottom up
        validate::check([validate::at_most_items("labelIds", &self.label_ids, 10)])?;
        Ok(self)
    }
}
