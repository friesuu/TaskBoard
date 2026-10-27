import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { TasksService } from '../tasks/tasks.service';
import { TaskStatus } from '../tasks/tasks-status.enum';
import { UpdateTaskDto } from '../tasks/update-task.dto';
import { NotFoundException } from '@nestjs/common';

const STATUS = z.enum(['todo', 'in_progress', 'done']); // the same names Claude sees in <my_tasks>
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// The tools Claude may use, built fresh for ONE user and ONE board on every message.
// ownerId comes from the login cookie and boardId from the board on screen; neither is a tool input,
// so Claude can only reach this user's tasks on this board.
// These call TasksService directly, so GraphQL's ValidationPipe doesn't run: the zod rules below are the validation.
export function taskTools(tasksService: TasksService, ownerId: number, boardId: number) {
  // A task id from another board is treated like one that doesn't exist
  const checkOnThisBoard = async (id: number) => {
    const task = await tasksService.findOwned(id, ownerId);
    if (task.boardId !== boardId) throw new NotFoundException(`Task ${id} not found on this board`);
  };

  return [
    betaZodTool({
      name: 'create_task',
      description: 'Create a new task. It goes to the bottom of its column.',
      inputSchema: z.object({
        title: z.string().trim().min(1).max(100),
        description: z.string().max(10000).optional(),
        dueDate: DATE.optional().describe('YYYY-MM-DD'),
        status: STATUS.optional().describe('Column, default todo'),
      }),
      run: async ({ status, ...rest }) => {
        const task = await tasksService.create({ ...rest, boardId, status: status as TaskStatus | undefined }, ownerId);
        return `Created task #${task.id} "${task.title}" in ${task.status}.`;
      },
    }),

    betaZodTool({
      name: 'update_task',
      description:
        "Change a task's title, description or due date, using its id from <my_tasks>. " +
        'To change its column, use move_task instead; for labels and checklists, their own tools.',
      inputSchema: z.object({
        id: z.number().int(),
        title: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(10000).optional(),
        dueDate: DATE.nullable().optional().describe('YYYY-MM-DD, or null to remove the due date'),
      }),
      run: async ({ id, ...changes }) => {
        await checkOnThisBoard(id);
        // dueDate null removes it, as the app's own "No due date" does (the DTO's type only says string)
        const task = await tasksService.update(id, changes as UpdateTaskDto, ownerId);
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
        await checkOnThisBoard(id);
        // A number past the end means "at the bottom" (your move() already handles that)
        const task = await tasksService.move(id, { status: status as TaskStatus, position: position ?? 1_000_000 }, ownerId);
        return `Moved task #${task.id} "${task.title}" to ${task.status}.`;
      },
    }),
  ];
}