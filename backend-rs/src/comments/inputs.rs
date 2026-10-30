//! What writing and editing a comment take, and the input rules (comment.dto.ts in NestJS)

use async_graphql::InputObject;

use crate::validate;

/// Used for both writing and editing a comment
#[derive(InputObject)]
#[graphql(name = "CommentInput")]
pub struct CommentInput {
    pub body: String,
}

impl CommentInput {
    /// The body trimmed, then @IsString @IsNotEmpty @MaxLength(2000)
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.body = validate::trimmed("body", &self.body, 2000)?.to_string();
        Ok(self)
    }
}
