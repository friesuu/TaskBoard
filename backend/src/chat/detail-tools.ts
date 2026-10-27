import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TasksService } from '../tasks/tasks.service';
import { LabelsService } from '../labels/labels.service';
import { ChecklistService } from '../checklist/checklist.service';
import { LabelColor } from '../labels/label-color.enum';

const COLOR = z.enum(Object.values(LabelColor) as [LabelColor, ...LabelColor[]]);
const LABEL_NAME = z.string().trim().min(1).max(30);
const ITEM_TEXT = z.string().trim().min(1).max(200);

// The assistant's tools for a task's other details: its labels (and the board's labels) and its checklist.
// Built for ONE user and ONE board, like taskTools: ownerId and boardId are never tool inputs.
// Labels go by name, as the user says them; checklist items by the ids in <my_tasks>.
// Nothing here deletes: deleting a label or a checklist item stays with the user, like deleting a task.
export function detailTools(
  tasksService: TasksService,
  labelsService: LabelsService,
  checklistService: ChecklistService,
  ownerId: number,
  boardId: number,
) {
  // A task id from another board is treated like one that doesn't exist
  const checkOnThisBoard = async (id: number) => {
    const task = await tasksService.findOwned(id, ownerId);
    if (task.boardId !== boardId) throw new NotFoundException(`Task ${id} not found on this board`);
    return task;
  };

  // "urgent" finds the label "Urgent"; an unknown name says which labels there are
  const labelNamed = async (name: string) => {
    const labels = await labelsService.findAll(boardId, ownerId);
    const label = labels.find((l) => l.name.toLowerCase() === name.trim().toLowerCase());
    if (!label) {
      const names = labels.map((l) => `"${l.name}"`).join(', ') || 'none yet';
      throw new NotFoundException(`No label called "${name}" on this board. Its labels: ${names}`);
    }
    return label;
  };

  return [
    betaZodTool({
      name: 'change_task_labels',
      description:
        "Add labels to a task and/or take labels off it, by label name. The labels must already exist on " +
        'this board (create_label makes new ones). Labels not named stay as they are.',
      inputSchema: z.object({
        id: z.number().int(),
        add: z.array(LABEL_NAME).max(10).optional(),
        remove: z.array(LABEL_NAME).max(10).optional(),
      }),
      run: async ({ id, add = [], remove = [] }) => {
        const task = await checkOnThisBoard(id);
        const toAdd = await Promise.all(add.map(labelNamed));
        const toRemove = new Set((await Promise.all(remove.map(labelNamed))).map((l) => l.id));
        const ids = new Set([...task.labels.map((l) => l.id), ...toAdd.map((l) => l.id)].filter((i) => !toRemove.has(i)));
        const updated = await labelsService.setTaskLabels(id, ownerId, [...ids]);
        const now = updated.labels.map((l) => l.name).join(', ') || 'no labels';
        return `Task #${updated.id} "${updated.title}" now has: ${now}.`;
      },
    }),

    betaZodTool({
      name: 'create_label',
      description: 'Create a new label on this board. It is not put on any task until you use change_task_labels.',
      inputSchema: z.object({ name: LABEL_NAME, color: COLOR }),
      run: async ({ name, color }) => {
        const label = await labelsService.create(boardId, ownerId, { name, color });
        return `Created the label "${label.name}" (${label.color}).`;
      },
    }),

    betaZodTool({
      name: 'update_label',
      description: "Rename and/or recolour one of this board's labels. Every task with it shows the change.",
      inputSchema: z.object({ name: LABEL_NAME.describe('Its current name'), newName: LABEL_NAME.optional(), color: COLOR.optional() }),
      run: async ({ name, newName, color }) => {
        if (newName === undefined && color === undefined) throw new BadRequestException('Give a new name or a colour');
        const label = await labelsService.update((await labelNamed(name)).id, ownerId, { name: newName, color });
        return `The label is now "${label.name}" (${label.color}).`;
      },
    }),

    betaZodTool({
      name: 'add_checklist_items',
      description: "Add items to the bottom of a task's checklist, in the order given.",
      inputSchema: z.object({ id: z.number().int().describe('The task id'), items: z.array(ITEM_TEXT).min(1).max(20) }),
      run: async ({ id, items }) => {
        const task = await checkOnThisBoard(id);
        for (const text of items) await checklistService.add(task.id, ownerId, text); // one by one, to keep the order
        return `Added ${items.length} checklist ${items.length === 1 ? 'item' : 'items'} to task #${task.id} "${task.title}".`;
      },
    }),

    betaZodTool({
      name: 'update_checklist_item',
      description: 'Tick or untick a checklist item, and/or change its text, using its id from <my_tasks> (like c31).',
      inputSchema: z.object({
        itemId: z.number().int().describe('The number after the c, e.g. 31 for c31'),
        done: z.boolean().optional(),
        text: ITEM_TEXT.optional(),
      }),
      run: async ({ itemId, done, text }) => {
        if (done === undefined && text === undefined) throw new BadRequestException('Give done and/or text');
        await checkOnThisBoard((await checklistService.findOne(itemId, ownerId)).taskId);
        const item = await checklistService.update(itemId, ownerId, { done, text });
        return `Checklist item c${item.id} "${item.text}" is ${item.done ? 'ticked' : 'not ticked'}.`;
      },
    }),
  ];
}
