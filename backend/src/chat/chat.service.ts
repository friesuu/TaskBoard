import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMessage } from './chat-message.entity';
import { LlmService } from './llm.service';
import { TasksService } from '../tasks/tasks.service';
import { Task } from '../tasks/task.entity';
import { taskTools } from './task-tools';
import { BoardsService } from '../boards/boards.service';
import { aiTools } from './ai-tools';
import { CommentsService } from '../comments/comments.service';
import { PromptReviewService } from '../runner/prompt-review.service';
import { AiActivityService } from '../runner/ai-activity.service';
import { detailTools } from './detail-tools';
import { LabelsService } from '../labels/labels.service';
import { ChecklistService } from '../checklist/checklist.service';
import { ChecklistItem } from '../checklist/checklist-item.entity';
import { Label } from '../labels/label.entity';

const MEMORY_SIZE = 20; // how many earlier messages Claude "remembers"

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly messagesRepository: Repository<ChatMessage>,
    private readonly tasksService: TasksService,
    private readonly llmService: LlmService,
    private readonly boardsService: BoardsService,
    private readonly commentsService: CommentsService,
    private readonly promptReviewService: PromptReviewService,
    private readonly aiActivityService: AiActivityService,
    private readonly labelsService: LabelsService,
    private readonly checklistService: ChecklistService,
  ) {}

  // The whole conversation, oldest first (for the screen)
  history(ownerId: number): Promise<ChatMessage[]> {
    return this.messagesRepository.find({ where: { ownerId }, order: { id: 'ASC' } });
  }

  async send(ownerId: number, boardId: number, text: string): Promise<ChatMessage> {
    const board = await this.boardsService.findOwned(boardId, ownerId); // "not found" if it isn't yours

    // 1. Memory: the last MEMORY_SIZE messages, oldest first
    const recent = await this.messagesRepository.find({
      where: { ownerId },
      order: { id: 'DESC' },
      take: MEMORY_SIZE,
    });

    recent.reverse();
    // Claude needs the conversation to start with a user message
    while (recent.length > 0 && recent[0].role === 'assistant') recent.shift();

    // 2. Context: this board's tasks right now (attached to this message only, never saved)
    const tasks = await this.tasksService.findAll(ownerId, boardId);
    const [labels, items] = await Promise.all([
      this.labelsService.findAll(boardId, ownerId),
      this.checklistService.forTasks(tasks.map((t) => t.id)),
    ]);
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const context =
      `<my_tasks>\nToday is ${today}. Board: "${board.name}".\n${describeLabels(labels)}\n${describeTasks(tasks, items)}\n</my_tasks>\n\n`;

    // 3. Ask Claude: memory + the new message, timed so the chat can show how long the answer took
    const started = Date.now();
    const answer = await this.llmService.reply([
      ...recent.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: context + text },],
      [ // built for THIS user and THIS board only
        ...taskTools(this.tasksService, ownerId, boardId),
        ...aiTools(this.tasksService, this.commentsService, this.promptReviewService, this.aiActivityService, ownerId, boardId),
        ...detailTools(this.tasksService, this.labelsService, this.checklistService, ownerId, boardId),
      ],
    );
    const responseMs = Date.now() - started; // in milliseconds, including any tool steps (e.g. creating tasks)

    // 4. Save both only now, so a failed request leaves no half-finished turn behind
    const [, saved] = await this.messagesRepository.save([
      this.messagesRepository.create({ ownerId, role: 'user', content: text }),
      this.messagesRepository.create({ ownerId, role: 'assistant', content: answer, responseMs }),
    ]);

    
    return saved;
  }

  async clear(ownerId: number): Promise<void> {
    await this.messagesRepository.delete({ ownerId });
  }
}

// The board's labels, e.g. "Labels on this board: AI (teal), Urgent (orange)"
function describeLabels(labels: Label[]): string {
  if (labels.length === 0) return 'Labels on this board: none yet.';
  return `Labels on this board: ${labels.map((l) => `${l.name} (${l.color})`).join(', ')}`;
}

// One line per task, then its checklist, e.g.
//   - #12 [todo] Pay invoice (due 2026-10-20) {labels: Urgent}: ask Tom
//       [x] c31 Find the invoice
function describeTasks(tasks: Task[], items: ChecklistItem[]): string {
  if (tasks.length === 0) return 'No tasks yet.';
  return tasks
    .map((t) => {
      const labels = t.labels?.length ? ` {labels: ${t.labels.map((l) => l.name).join(', ')}}` : '';
      const line = `- #${t.id} [${t.status}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ''}${labels}` +
        `${t.changesRequested ? ' (Claude revising prompt)' : ''}${t.aiError ? ' (runner stopped)' : ''}` +
        `${t.description ? `: ${t.description}` : ''}`;
      const checklist = items
        .filter((i) => i.taskId === t.id)
        .map((i) => `\n    [${i.done ? 'x' : ' '}] c${i.id} ${i.text}`)
        .join('');
      return line + checklist;
    })
    .join('\n');
}
