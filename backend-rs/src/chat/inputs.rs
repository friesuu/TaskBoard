//! What sendChatMessage takes, and its input rules (send-chat-message.dto.ts in NestJS)

use async_graphql::InputObject;

use crate::validate;

#[derive(InputObject)]
#[graphql(name = "SendChatMessageInput")]
pub struct SendChatMessageInput {
    pub board_id: i32, // the board you're looking at: the assistant only sees and changes tasks on it
    pub message: String,
}

impl SendChatMessageInput {
    /// The message trimmed, then @IsString @IsNotEmpty @MaxLength(2000) (which keeps each request, and its cost,
    /// small)
    pub fn checked(mut self) -> async_graphql::Result<Self> {
        self.message = validate::trimmed("message", &self.message, 2000)?.to_string();
        Ok(self)
    }
}
