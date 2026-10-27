import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { TaskStatus } from '../tasks/tasks-status.enum';
import { TasksService } from '../tasks/tasks.service';
import { TaskComment } from '../comments/task-comment.entity';

// A spot past the end of any column: moving there puts the task at the bottom
export const BOTTOM = 1_000_000;

// The blanks Claude leaves for you in a prompt, e.g. "[[FILL IN: which page should this go on?]]"
const BLANK = /\[\[\s*FILL IN/i;

// What YOU do with Claude's prompt in the task panel: edit it, approve it, or ask for changes.
// Approving is the only way a task gets built: it copies the prompt into approvedPrompt, the exact text
// the runner will carry out.
@Injectable()
export class PromptReviewService {
  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectRepository(TaskComment)
    private readonly commentsRepository: Repository<TaskComment>,
    private readonly tasksService: TasksService,
  ) {}

  // Your edits. Editing cancels any earlier approval: only the text you approve last gets built.
  async editPrompt(taskId: number, ownerId: number, prompt: string): Promise<Task> {
    const task = await this.waitingForReview(taskId, ownerId);
    await this.tasksRepository.update(task.id, { refinedPrompt: prompt, approvedPrompt: null, promptApprovedAt: null });
    return this.tasksService.findOwned(task.id, ownerId);
  }

  // Approve: the prompt is locked in, and the task moves to In progress, where the runner picks it up
  async approve(taskId: number, ownerId: number): Promise<Task> {
    const task = await this.waitingForReview(taskId, ownerId);
    if (task.changesRequested) throw new BadRequestException('Claude is still revising this prompt');
    if (BLANK.test(task.refinedPrompt!)) {
      throw new BadRequestException('Fill in the [[FILL IN: …]] blanks in the prompt first');
    }
    await this.tasksRepository.update(task.id, {
      approvedPrompt: task.refinedPrompt,
      promptApprovedAt: new Date(),
      aiError: null,
    });
    return this.tasksService.move(task.id, { status: TaskStatus.IN_PROGRESS, position: BOTTOM }, ownerId);
  }

  // Request changes: your comment goes on the task, and Claude revises the prompt on its next run.
  // The task stays in Prompt Review, with "Revising…" on its card.
  async requestChanges(taskId: number, ownerId: number, comment: string): Promise<Task> {
    const task = await this.waitingForReview(taskId, ownerId);
    await this.commentsRepository.save(this.commentsRepository.create({ taskId: task.id, authorId: ownerId, body: comment, kind: 'feedback' }));
    await this.tasksRepository.update(task.id, { changesRequested: true, aiError: null });
    return this.tasksService.findOwned(task.id, ownerId);
  }

  // Your feedback on Claude's prompts, and Claude's notes from before it had its own log, oldest first.
  // They're shown in the task's AI tab, not under Comments.
  async aiNotes(taskId: number, ownerId: number): Promise<TaskComment[]> {
    await this.tasksService.findOwned(taskId, ownerId);
    return this.commentsRepository.find({
      where: { taskId, kind: In(['feedback', 'claude']) },
      relations: { author: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  // Merge, after you've checked a build in AI Review: the runner merges the branch on its next check (it
  // has git; the board doesn't). Only a build that went fine: Claude finished and the checks passed.
  async requestMerge(taskId: number, ownerId: number): Promise<Task> {
    const task = await this.tasksService.findOwned(taskId, ownerId);
    if (task.status !== TaskStatus.AI_REVIEW || !task.aiBranch || !task.aiBuiltAt) {
      throw new BadRequestException('Only a built task in AI Review can be merged');
    }
    if (task.aiChecksPassed !== true) {
      throw new BadRequestException("This build's checks didn't pass: merge it by hand if you still want it");
    }
    if (task.aiMergedAt) throw new BadRequestException('This branch is already merged');
    await this.tasksRepository.update(task.id, { aiMergeRequestedAt: new Date(), aiError: null });
    return this.tasksService.findOwned(task.id, ownerId);
  }

  // "Try again" after the runner stopped on a task: it's picked up again on the next run
  async retry(taskId: number, ownerId: number): Promise<Task> {
    const task = await this.tasksService.findOwned(taskId, ownerId);
    await this.tasksRepository.update(task.id, { aiError: null });
    return this.tasksService.findOwned(task.id, ownerId);
  }

  private async waitingForReview(taskId: number, ownerId: number): Promise<Task> {
    const task = await this.tasksService.findOwned(taskId, ownerId); // someone else's task: "not found"
    if (task.status !== TaskStatus.PROMPT_REVIEW || !task.refinedPrompt) {
      throw new BadRequestException('This task has no prompt waiting for your review');
    }
    return task;
  }
}
