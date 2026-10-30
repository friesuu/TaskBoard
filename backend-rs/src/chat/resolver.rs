//! The chat's GraphQL operations (chat.resolver.ts in NestJS): the login check, the rate limit, the input rules,
//! then the service. Every chat operation needs a login.

use async_graphql::{Context, Object};
use sqlx::PgPool;

use super::claude::Claude;
use super::inputs::SendChatMessageInput;
use super::service;
use super::types::ChatMessage;
use crate::auth::current_user;
use crate::throttle::limit_chat_messages;

/// The chat's part of the GraphQL Query type
#[derive(Default)]
pub struct ChatQuery;

#[Object]
impl ChatQuery {
    /// Your whole conversation, oldest first
    async fn chat_messages(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<ChatMessage>> {
        let user = current_user(ctx).await?;
        service::history(ctx.data::<PgPool>()?, user.id).await
    }
}

/// The chat's part of the GraphQL Mutation type
#[derive(Default)]
pub struct ChatMutation;

#[Object]
impl ChatMutation {
    /// One message about the board you're looking at; gives back Claude's answer. Every message costs money (the
    /// Claude API), so at most 10 a minute.
    async fn send_chat_message(
        &self,
        ctx: &Context<'_>,
        input: SendChatMessageInput,
    ) -> async_graphql::Result<ChatMessage> {
        let user = current_user(ctx).await?;
        limit_chat_messages(ctx, &user)?;
        let input = input.checked()?;
        service::send(
            ctx.data::<PgPool>()?,
            ctx.data::<Claude>()?,
            user.id,
            input.board_id,
            &input.message,
        )
        .await
    }

    async fn clear_chat(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        let user = current_user(ctx).await?;
        service::clear(ctx.data::<PgPool>()?, user.id).await?;
        Ok(true)
    }
}
