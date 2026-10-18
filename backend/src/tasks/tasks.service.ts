import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './task.entity';
import { CreateTaskDto } from './create-task.dto';
import { UpdateTaskDto } from './update-task.dto';
import { MoveTaskDto } from './move-task.dto';
import { TaskStatus } from './tasks-status.enum';
import { BoardsService } from '../boards/boards.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    private readonly boardsService: BoardsService,
  ) {}

  // One board's tasks, each with its labels. ownerId stays in the filter, so another user's board id just gives [].
  async findAll(ownerId: number, boardId: number): Promise<Task[]> {
    const tasks = await this.tasksRepository.find({
      where: { ownerId, boardId },
      relations: { labels: true },
      order: {
        position: 'ASC',
        createdAt: 'ASC', // tie-breaker for tasks that share a position (e.g. old rows, all 0)
        id: 'ASC', // ORDER BY in SQL, 'ASC' means in ascending order
      },
    });
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

  async create(dto: CreateTaskDto, ownerId: number): Promise<Task> {
    await this.boardsService.findOwned(dto.boardId, ownerId); // you can only add tasks to your own boards
    const task = this.tasksRepository.create(dto);
    task.position = await this.nextPosition(task.status ?? TaskStatus.TODO, dto.boardId);
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
