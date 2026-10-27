import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { TaskStatus } from '../tasks/tasks-status.enum';
import { TasksService } from '../tasks/tasks.service';
import { BoardsService } from '../boards/boards.service';
import { TaskComment } from '../comments/task-comment.entity';
import { ChecklistItem } from '../checklist/checklist-item.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RunnerJob, RunnerJobKind } from './runner-job.type';
import { BOTTOM } from './prompt-review.service';

// Only tasks with a label of this name (any capitals: "AI", "ai") are ever touched by the runner
const AI_LABEL = 'ai';

// The runner's side of the workflow. Every step checks, here on the server, that the task really is
// waiting for that step. So the runner can never build a prompt you haven't approved, even if it tried.
@Injectable()
export class RunnerService {
  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectRepository(TaskComment)
    private readonly commentsRepository: Repository<TaskComment>,
    @InjectRepository(ChecklistItem)
    private readonly checklistRepository: Repository<ChecklistItem>,
    private readonly tasksService: TasksService,
    private readonly boardsService: BoardsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // The next thing to do, one task at a time: first a merge you asked for (quick, and no Claude), then
  // anything approved and waiting to be built (oldest approval first), then any prompt to write or revise
  // (oldest task first). null = nothing to do.
  // kinds: the jobs this runner can do. An older runner doesn't know MERGE, so it's never handed one.
  async nextJob(ownerId: number, kinds: RunnerJobKind[] = [RunnerJobKind.BUILD, RunnerJobKind.REFINE]): Promise<RunnerJob | null> {
    for (const kind of [RunnerJobKind.MERGE, RunnerJobKind.BUILD, RunnerJobKind.REFINE]) {
      if (!kinds.includes(kind)) continue;
      const task = await this.waiting(ownerId, kind).getOne();
      if (task) return this.jobFor(task.id, ownerId, kind);
    }
    return null;
  }

  // The prompt Claude wrote (or revised). A new one moves the task to Prompt Review.
  async savePrompt(taskId: number, ownerId: number, prompt: string): Promise<Task> {
    const task = await this.claim(taskId, ownerId, RunnerJobKind.REFINE);
    const isRevision = task.status === TaskStatus.PROMPT_REVIEW;
    await this.tasksRepository.update(task.id, {
      refinedPrompt: prompt,
      changesRequested: false,
      approvedPrompt: null,
      promptApprovedAt: null,
    });
    if (!isRevision) {
      await this.tasksService.move(task.id, { status: TaskStatus.PROMPT_REVIEW, position: BOTTOM }, ownerId);
    }
    await this.notificationsService.notify(
      ownerId, 'prompt_ready', isRevision ? 'Revised prompt ready for approval' : 'Prompt ready for approval', task.id,
    );
    return this.tasksService.findOwned(task.id, ownerId);
  }

  // The runner made the task's branch and is about to start. Marking it stops it being picked twice.
  async startBuild(taskId: number, ownerId: number, branch: string): Promise<Task> {
    const task = await this.claim(taskId, ownerId, RunnerJobKind.BUILD);
    await this.tasksRepository.update(task.id, {
      aiBranch: branch, aiBuiltAt: null, aiChecksPassed: null, aiMergeRequestedAt: null, aiMergedAt: null,
    });
    return this.tasksService.findOwned(task.id, ownerId);
  }

  // Done (whether or not the build and tests passed: the summary says which). Moves the task to AI Review.
  // Only for a build that's running: started, and not finished yet.
  // checksPassed: false when Claude stopped early or the runner's checks failed; the task then shows as
  // Failed (it's still in AI Review, for you to look at). The summary is on the run (AiActivityService).
  async finishBuild(taskId: number, ownerId: number, checksPassed: boolean): Promise<Task> {
    const task = await this.tasksService.findOwned(taskId, ownerId);
    if (task.status !== TaskStatus.IN_PROGRESS || !task.aiBranch || task.aiBuiltAt) {
      throw new BadRequestException(`Task ${taskId} isn't being built`);
    }
    await this.tasksRepository.update(task.id, { aiBuiltAt: new Date(), aiChecksPassed: checksPassed });
    await this.notificationsService.notify(
      ownerId, checksPassed ? 'review_ready' : 'run_failed',
      checksPassed ? 'Ready for review' : 'Built, but it needs a look: the checks failed or Claude stopped early', task.id,
    );
    return this.tasksService.move(task.id, { status: TaskStatus.AI_REVIEW, position: BOTTOM }, ownerId);
  }

  // The runner merged the branch you clicked Merge on: the work is in the project, so the task is Done
  async finishMerge(taskId: number, ownerId: number): Promise<Task> {
    const task = await this.claim(taskId, ownerId, RunnerJobKind.MERGE);
    await this.tasksRepository.update(task.id, { aiMergedAt: new Date() });
    await this.notificationsService.notify(ownerId, 'merged', 'Merged into the project', task.id);
    return this.tasksService.move(task.id, { status: TaskStatus.DONE, position: BOTTOM }, ownerId);
  }

  // The runner couldn't carry on (e.g. the spend cap was reached). The task stays where it is and is
  // skipped until you click "Try again".
  async reportError(taskId: number, ownerId: number, message: string): Promise<Task> {
    const task = await this.tasksService.findOwned(taskId, ownerId);
    await this.tasksRepository.update(task.id, { aiError: message });
    await this.notificationsService.notify(ownerId, 'run_failed', `Claude stopped: ${message}`, task.id);
    return this.tasksService.findOwned(task.id, ownerId);
  }

  // Your tasks waiting for this step: "AI" label, on a board with a project, not stopped by an error
  private waiting(ownerId: number, kind: RunnerJobKind, taskId?: number): SelectQueryBuilder<Task> {
    const query = this.tasksRepository
      .createQueryBuilder('task')
      .innerJoin('task.board', 'board')
      .innerJoin('task.labels', 'label', 'LOWER(label.name) = :aiLabel', { aiLabel: AI_LABEL })
      .where('task.ownerId = :ownerId', { ownerId })
      .andWhere('board.project IS NOT NULL')
      .andWhere('task.aiError IS NULL');
    if (taskId !== undefined) query.andWhere('task.id = :taskId', { taskId });

    if (kind === RunnerJobKind.MERGE) {
      // A build that went fine, in AI Review, that you clicked Merge on, not merged yet
      return query
        .andWhere('task.status = :aiReview', { aiReview: TaskStatus.AI_REVIEW })
        .andWhere('task.aiBranch IS NOT NULL AND task.aiBuiltAt IS NOT NULL AND task.aiChecksPassed = true')
        .andWhere('task.aiMergeRequestedAt IS NOT NULL AND task.aiMergedAt IS NULL')
        .orderBy('task.aiMergeRequestedAt', 'ASC')
        .addOrderBy('task.id', 'ASC');
    }
    if (kind === RunnerJobKind.BUILD) {
      // Approved and in In progress: not started yet, or built before and moved back to In progress
      // (then it's built again, from scratch on a new branch). Never while a build is running.
      return query
        .andWhere('task.status = :inProgress', { inProgress: TaskStatus.IN_PROGRESS })
        .andWhere('task.approvedPrompt IS NOT NULL')
        .andWhere('(task.aiBranch IS NULL OR task.aiBuiltAt IS NOT NULL)')
        .orderBy('task.promptApprovedAt', 'ASC')
        .addOrderBy('task.id', 'ASC');
    }
    // A new task in To do with no prompt yet, or a prompt you asked Claude to change
    return query
      .andWhere(new Brackets((qb) => qb
        .where('task.status = :todo AND task.refinedPrompt IS NULL', { todo: TaskStatus.TODO })
        .orWhere('task.status = :promptReview AND task.changesRequested = true', { promptReview: TaskStatus.PROMPT_REVIEW })))
      .orderBy('task.createdAt', 'ASC')
      .addOrderBy('task.id', 'ASC');
  }

  // The task, but only if it really is waiting for this step right now
  private async claim(taskId: number, ownerId: number, kind: RunnerJobKind): Promise<Task> {
    if (!(await this.waiting(ownerId, kind, taskId).getOne())) {
      throw new BadRequestException(`Task ${taskId} isn't waiting for this step`);
    }
    return this.tasksService.findOwned(taskId, ownerId);
  }

  private async jobFor(taskId: number, ownerId: number, kind: RunnerJobKind): Promise<RunnerJob> {
    const task = await this.tasksService.findOwned(taskId, ownerId);
    const board = await this.boardsService.findOwned(task.boardId, ownerId);
    const [comments, checklist] = await Promise.all([
      this.commentsRepository.find({ where: { taskId }, relations: { author: true }, order: { createdAt: 'ASC', id: 'ASC' } }),
      this.checklistRepository.find({ where: { taskId }, order: { position: 'ASC' } }),
    ]);
    return {
      kind,
      project: board.project!,
      task,
      approvedPrompt: kind === RunnerJobKind.BUILD ? task.approvedPrompt : null,
      comments,
      checklist,
    };
  }

}
