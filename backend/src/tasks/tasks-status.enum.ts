import { registerEnumType } from "@nestjs/graphql";

// The board's columns, in order. PROMPT_REVIEW and AI_REVIEW belong to the Claude runner:
// Prompt Review = Claude wrote a prompt for you to approve; AI Review = Claude built it, for you to check.
export enum TaskStatus {
  TODO = 'todo',
  PROMPT_REVIEW = 'prompt_review',
  IN_PROGRESS = 'in_progress',
  AI_REVIEW = 'ai_review',
  DONE = 'done',
}

registerEnumType(TaskStatus, { name: 'TaskStatus'});
