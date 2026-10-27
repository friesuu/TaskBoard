import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { NotFoundException } from '@nestjs/common';
import { TasksService } from '../tasks/tasks.service';
import { CommentsService } from '../comments/comments.service';
import { PromptReviewService } from '../runner/prompt-review.service';
import { AiActivityService } from '../runner/ai-activity.service';

const RUNS_SHOWN = 5; // a task's newest runs; older ones rarely matter in a chat
const MAX_TEXT = 4000; // a long prompt or build summary is cut, so one task can't fill the context

// The assistant's view of the Claude runner: read what it did on a task, and review its prompt
// (approve / request changes) like the buttons in the task panel. Built for ONE user and ONE board,
// like taskTools: ownerId and boardId are never tool inputs.
export function aiTools(
  tasksService: TasksService,
  commentsService: CommentsService,
  promptReviewService: PromptReviewService,
  aiActivityService: AiActivityService,
  ownerId: number,
  boardId: number,
) {
  // A task id from another board is treated like one that doesn't exist
  const checkOnThisBoard = async (id: number) => {
    const task = await tasksService.findOwned(id, ownerId);
    if (task.boardId !== boardId) throw new NotFoundException(`Task ${id} not found on this board`);
    return task;
  };

  const describe = async (id: number): Promise<string> => {
    const task = await checkOnThisBoard(id);
    const [notes, comments, runs] = await Promise.all([
      promptReviewService.aiNotes(id, ownerId),
      commentsService.findAll(id, ownerId),
      aiActivityService.runsFor(id, ownerId),
    ]);

    const lines = [`Task #${task.id} "${task.title}" [${task.status}]`];
    if (task.refinedPrompt) lines.push(`Claude's prompt:\n${cut(task.refinedPrompt)}`);
    else lines.push('Claude has not written a prompt for it yet.');
    if (task.changesRequested) lines.push('Changes requested: Claude will revise the prompt on its next run.');
    if (task.promptApprovedAt) lines.push(`Prompt approved: ${task.promptApprovedAt.toISOString()}`);
    if (task.aiBranch) lines.push(`Branch: ${task.aiBranch}`);
    if (task.aiError) lines.push(`Runner stopped on it: ${task.aiError}`);

    for (const note of notes) {
      lines.push(`${note.kind === 'claude' ? 'Claude note' : 'User feedback on the prompt'}: ${cut(note.body)}`);
    }
    for (const comment of comments) {
      lines.push(`Comment by ${comment.author.displayName ?? comment.author.email}: ${cut(comment.body)}`);
    }

    if (runs.length === 0) lines.push('No runs yet.');
    for (const run of runs.slice(0, RUNS_SHOWN)) {
      const parts = [`Run ${run.startedAt.toISOString()}: ${run.step}, ${run.status} (${run.result})`];
      if (run.checksPassed !== null) parts.push(`checks ${run.checksPassed ? 'passed' : 'failed'}`);
      if (run.error) parts.push(`error: ${cut(run.error)}`);
      if (run.summary) parts.push(`summary:\n${cut(run.summary)}`);
      lines.push(parts.join(', '));
    }
    return lines.join('\n');
  };

  return [
    betaZodTool({
      name: 'get_ai_details',
      description:
        "Read what the Claude runner did on tasks: its prompt, the user's feedback on it, comments, " +
        'and the newest runs (result, errors, build summary). Use it before answering questions about ' +
        'a prompt, a build or a failure, and before approving or requesting changes.',
      inputSchema: z.object({
        ids: z.array(z.number().int()).min(1).max(5).describe('Task ids from <my_tasks>'),
      }),
      run: async ({ ids }) => {
        const parts = await Promise.all(ids.map((id) => describe(id).catch((e: Error) => `Task #${id}: ${e.message}`)));
        return parts.join('\n\n');
      },
    }),

    betaZodTool({
      name: 'approve_prompt',
      description:
        "Approve Claude's prompt for a task in prompt_review. The task moves to in_progress and the " +
        "runner builds it on the user's machine. Only when the user clearly asks to approve that task.",
      inputSchema: z.object({ id: z.number().int() }),
      run: async ({ id }) => {
        await checkOnThisBoard(id);
        const task = await promptReviewService.approve(id, ownerId);
        return `Approved the prompt of task #${task.id} "${task.title}"; it moved to ${task.status}.`;
      },
    }),

    betaZodTool({
      name: 'request_prompt_changes',
      description:
        "Send feedback on Claude's prompt for a task in prompt_review. Claude revises the prompt on its " +
        "next run. Write the comment as instructions for Claude, in the user's words where possible.",
      inputSchema: z.object({
        id: z.number().int(),
        comment: z.string().trim().min(1).max(5000),
      }),
      run: async ({ id, comment }) => {
        await checkOnThisBoard(id);
        const task = await promptReviewService.requestChanges(id, ownerId, comment);
        return `Requested changes on task #${task.id} "${task.title}"; Claude will revise its prompt.`;
      },
    }),
  ];
}

function cut(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}… (cut)` : text;
}
