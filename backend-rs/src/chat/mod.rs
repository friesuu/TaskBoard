//! The chat assistant (the chat module in NestJS, ../backend/src/chat): you write to Claude about the board you're
//! looking at, and Claude answers. It sees that board's tasks, and can change them with its tools, but only on that
//! board, only yours, and it can never delete anything.
//!
//! One message, step by step (service::send):
//!   1. the conversation so far (the last 20 messages: Claude's memory)
//!   2. the board as it is now, written out for Claude (<my_tasks>, context.rs), in front of your message
//!   3. Claude answers, maybe after using its tools a few times (claude.rs runs the loop, tools/ runs the tools)
//!   4. your message and the answer are saved, both or neither
//!
//! The files, as NestJS splits them:
//!   types.rs     what the API shows: ChatMessage (chat-message.entity.ts)
//!   inputs.rs    what sendChatMessage takes, and its input rules (send-chat-message.dto.ts)
//!   resolver.rs  the GraphQL operations: the login check, the rate limit, the input rules, then the service
//!   service.rs   the work itself, with no GraphQL in it (chat.service.ts)
//!   context.rs   the board written out for Claude (describeLabels, describeTasks in chat.service.ts)
//!   claude.rs    talking to the Claude API, and the tool loop (llm.service.ts, and the SDK's tool runner)
//!   tools/       the assistant's tools (task-tools.ts, ai-tools.ts, detail-tools.ts)

mod claude;
mod context;
mod inputs;
mod resolver;
mod service;
mod tools;
mod types;

pub use claude::Claude;
pub use resolver::{ChatMutation, ChatQuery};
