import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Task } from './task.entity';
import { CreateTaskDto } from './create-task.dto';
import { UpdateTaskDto } from './update-task.dto';
import { MoveTaskDto } from './move-task.dto';
import { TaskStatus } from './tasks-status.enum';
import { BoardsService } from '../boards/boards.service';
import { DueFilter, TaskFilterDto } from './task-filter.dto';
import { thisWeekIn, todayIn } from '../common/dates';
import { TaskStats } from './task-stats.type';

// When a task was finished: now when it moves INTO Done, kept while it stays in Done, cleared when it leaves Done
function completedAtFor(newStatus: TaskStatus, oldStatus: TaskStatus | null, current: Date | null): Date | null {
  if (newStatus !== TaskStatus.DONE) return null;
  return oldStatus === TaskStatus.DONE ? current : new Date();
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    private readonly boardsService: BoardsService,
  ) {}

  // One board's tasks, each with its labels. ownerId stays in the filter, so another user's board id just gives [].
  // filter (optional): search text, labels, columns and due date, all combined.
  // timeZone: the user's, so "today" and "this week" are their today and their week.
  async findAll(ownerId: number, boardId: number, filter?: TaskFilterDto, timeZone: string | null = null): Promise<Task[]> {
    const query = this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.labels', 'label')
      .where('task.ownerId = :ownerId', { ownerId })
      .andWhere('task.boardId = :boardId', { boardId })
      .orderBy('task.position', 'ASC')
      .addOrderBy('task.createdAt', 'ASC') // tie-breaker for tasks that share a position (e.g. old rows, all 0)
      .addOrderBy('task.id', 'ASC');

    if (filter?.q) {
      // %, _ and \ are special in ILIKE: put a \ before each, so "50%" searches for "50%"
      const like = `%${filter.q.replace(/[\\%_]/g, '\\$&')}%`;
      query.andWhere(new Brackets((match) => {
        match
          .where('task.title ILIKE :like')
          .orWhere('task.description ILIKE :like')
          .orWhere('EXISTS (SELECT 1 FROM checklist_items item WHERE item.task_id = task.id AND item.text ILIKE :like)');
      }), { like });
    }

    // ANY of the labels. A separate check (not the join above), so the task still comes back with ALL its labels.
    if (filter?.labelIds?.length) {
      query.andWhere(
        'EXISTS (SELECT 1 FROM task_labels link WHERE link.task_id = task.id AND link.label_id IN (:...labelIds))',
        { labelIds: filter.labelIds },
      );
    }

    if (filter?.statuses?.length) {
      query.andWhere('task.status IN (:...statuses)', { statuses: filter.statuses });
    }

    if (filter?.due) {
      const today = todayIn(timeZone);
      switch (filter.due) {
        case DueFilter.OVERDUE: // same rule as the red cards: due before today and not done
          query.andWhere('task.dueDate < :today AND task.status != :done', { today, done: TaskStatus.DONE });
          break;
        case DueFilter.TODAY:
          query.andWhere('task.dueDate = :today', { today });
          break;
        case DueFilter.THIS_WEEK: {
          const { monday, sunday } = thisWeekIn(timeZone);
          query.andWhere('task.dueDate BETWEEN :monday AND :sunday', { monday, sunday });
          break;
        }
        case DueFilter.NO_DATE:
          query.andWhere('task.dueDate IS NULL');
          break;
      }
    }

    const tasks = await query.getMany();
    tasks.forEach(sortLabels);
    return tasks;
  }

  // One of YOUR tasks, with its labels (the assistant's tools use this to check which board a task is on)
  async findOwned(id: number, ownerId: number): Promise<Task> {
    const task = await this.tasksRepository.findOne({ where: { id, ownerId }, relations: { labels: true } });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    sortLabels(task);
    return task;
  }

  // The profile's numbers, across ALL your boards: per column, overdue, due this week (not done yet),
  // and finished this week. "Today" and "this week" are the user's own (timeZone). One query.
  async stats(ownerId: number, timeZone: string | null): Promise<TaskStats> {
    const { monday, sunday } = thisWeekIn(timeZone);
    const count = (condition: string) => `(COUNT(*) FILTER (WHERE ${condition}))::int`;

    const row = await this.tasksRepository
      .createQueryBuilder('task')
      .select('(COUNT(*))::int', 'total')
      .addSelect(count('"task"."status" = :todo'), 'todo')
      .addSelect(count('"task"."status" = :promptReview'), 'promptReview')
      .addSelect(count('"task"."status" = :inProgress'), 'inProgress')
      .addSelect(count('"task"."status" = :aiReview'), 'aiReview')
      .addSelect(count('"task"."status" = :done'), 'done')
      .addSelect(count('"task"."due_date" < :today AND "task"."status" != :done'), 'overdue')
      .addSelect(count('"task"."due_date" BETWEEN :monday AND :sunday AND "task"."status" != :done'), 'dueThisWeek')
      // completed_at is a moment in time: turned into the user's own calendar date before comparing
      .addSelect(
        count('"task"."status" = :done AND ("task"."completed_at" AT TIME ZONE :timeZone)::date BETWEEN :monday AND :sunday'),
        'doneThisWeek',
      )
      .where('"task"."owner_id" = :ownerId', { ownerId })
      .setParameters({
        todo: TaskStatus.TODO,
        promptReview: TaskStatus.PROMPT_REVIEW,
        inProgress: TaskStatus.IN_PROGRESS,
        aiReview: TaskStatus.AI_REVIEW,
        done: TaskStatus.DONE,
        today: todayIn(timeZone),
        monday,
        sunday,
        timeZone: timeZone ?? 'UTC',
      })
      .getRawOne<TaskStats>();

    return row!;
  }

  async create(dto: CreateTaskDto, ownerId: number): Promise<Task> {
    await this.boardsService.findOwned(dto.boardId, ownerId); // you can only add tasks to your own boards
    const task = this.tasksRepository.create(dto);
    task.position = await this.nextPosition(task.status ?? TaskStatus.TODO, dto.boardId);
    task.completedAt = completedAtFor(task.status ?? TaskStatus.TODO, null, null); // e.g. the assistant adding a done task
    task.ownerId = ownerId;
    const saved = await this.tasksRepository.save(task);
    return this.findOwned(saved.id, ownerId); // loaded again so it comes back with its checklist counts (0/0)
  }

  async update(id: number, dto: UpdateTaskDto, ownerId: number): Promise<Task>
  {
    const task = await this.findOwned(id, ownerId);

    if(dto.title === null || dto.status === null)
    {
      throw new BadRequestException('Title and Status cannot be null');
    }

    // Changing column (e.g. from the dropdown) puts the task at the bottom of the new column
    if(dto.status !== undefined && dto.status !== task.status)
    {
      task.position = await this.nextPosition(dto.status, task.boardId);
      task.completedAt = completedAtFor(dto.status, task.status, task.completedAt);
    }

    this.tasksRepository.merge(task, dto);
    return this.tasksRepository.save(task);
  }

  // Puts a task at `position` in the `status` column of ITS board and renumbers that column 0, 1, 2...
  // Runs in a transaction so a half-finished renumbering is never saved.
  async move(id: number, dto: MoveTaskDto, ownerId: number): Promise<Task>
  {
    await this.tasksRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Task);

      const task = await repo.findOneBy({id, ownerId});
      if(!task)
      {
        throw new NotFoundException(`Task ${id} not found`);
      }
      const oldStatus = task.status;

      // The destination column without the moving task, in its current order
      const column = (await this.columnInOrder(repo, dto.status, task.boardId)).filter((t) => t.id !== id);

      // Insert at the requested spot (a number past the end means "at the bottom")
      const index = Math.min(dto.position, column.length);
      task.status = dto.status;
      task.completedAt = completedAtFor(dto.status, oldStatus, task.completedAt);
      column.splice(index, 0, task);
      column.forEach((t, i) => { t.position = i; });
      await repo.save(column);

      // Close the gap it left behind in its old column
      if(oldStatus !== dto.status)
      {
        const oldColumn = await this.columnInOrder(repo, oldStatus, task.boardId);
        oldColumn.forEach((t, i) => { t.position = i; });
        await repo.save(oldColumn);
      }
    });

    return this.findOwned(id, ownerId); // the moved task, with its labels and checklist counts
  }

  // Columns are per board: positions only count between tasks on the same board
  private columnInOrder(repo: Repository<Task>, status: TaskStatus, boardId: number): Promise<Task[]>
  {
    return repo.find({
      where: { status, boardId },
      order: { position: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
  }

  // One past the last position in a column, so a task added there lands at the bottom
  private async nextPosition(status: TaskStatus, boardId: number): Promise<number>
  {
    const last = await this.tasksRepository.findOne({
      where: { status, boardId },
      order: { position: 'DESC' },
    });
    return last ? last.position + 1 : 0;
  }

  async remove(id: number, ownerId: number): Promise<void>
  {
    const result = await this.tasksRepository.delete({id, ownerId});

    if( result.affected === 0)
    {
      throw new NotFoundException(`Task ${id} not found`);
    }
  }
}

// Labels in A-Z order, so they look the same on every card
function sortLabels(task: Task): void {
  task.labels?.sort((a, b) => a.name.localeCompare(b.name));
}
