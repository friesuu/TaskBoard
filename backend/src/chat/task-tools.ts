import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { TasksService } from '../tasks/tasks.service';
import { TaskStatus } from '../tasks/tasks-status.enum';

const STATUS = z.enum(['todo', 'in_progress', 'done']); // the same names Claude sees in <my_tasks>
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// The tools Claude may use, built fresh for ONE user on every message.
// ownerId comes from the login cookie and is never an input, so Claude can only reach this user's tasks.
// These call TasksService directly, so GraphQL's ValidationPipe doesn't run: the zod rules below are the validation.
export function taskTools(tasksService: TasksService, ownerId: number) {
  return [
    betaZodTool({
      name: 'create_task',
      description: 'Create a new task. It goes to the bottom of its column.',
      inputSchema: z.object({
        title: z.string().trim().min(1).max(100),
        description: z.string().max(2000).optional(),
        dueDate: DATE.optional().describe('YYYY-MM-DD'),
        status: STATUS.optional().describe('Column, default todo'),
      }),
      run: async ({ status, ...rest }) => {
        const task = await tasksService.create({ ...rest, status: status as TaskStatus | undefined }, ownerId);
        return `Created task #${task.id} "${task.title}" in ${task.status}.`;
      },
    }),

    betaZodTool({
      name: 'update_task',
      description:
        "Change a task's title, description or due date, using its id from <my_tasks>. " +
        'To change its column, use move_task instead.',
      inputSchema: z.object({
        id: z.number().int(),
        title: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(2000).optional(),
        dueDate: DATE.optional().describe('YYYY-MM-DD'),
      }),
      run: async ({ id, ...changes }) => {
        const task = await tasksService.update(id, changes, ownerId);
        return `Updated task #${task.id} "${task.title}".`;
      },
    }),

    betaZodTool({
      name: 'move_task',
      description:
        'Move a task to a column (todo, in_progress or done), using its id from <my_tasks>. ' +
        'position 0 = top of the column; leave it out to put the task at the bottom.',
      inputSchema: z.object({
        id: z.number().int(),
        status: STATUS,
        position: z.number().int().min(0).optional(),
      }),
      run: async ({ id, status, position }) => {
        // A number past the end means "at the bottom" (your move() already handles that)
        const task = await tasksService.move(id, { status: status as TaskStatus, position: position ?? 1_000_000 }, ownerId);
        return `Moved task #${task.id} "${task.title}" to ${task.status}.`;
      },
    }),
  ];
}