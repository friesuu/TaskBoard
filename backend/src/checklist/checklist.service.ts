import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChecklistItem } from './checklist-item.entity';
import { UpdateChecklistItemDto } from './checklist-item.dto';
import { TasksService } from '../tasks/tasks.service';

export const MAX_CHECKLIST_ITEMS = 100;

@Injectable()
export class ChecklistService {
  constructor(
    @InjectRepository(ChecklistItem)
    private readonly itemsRepository: Repository<ChecklistItem>,
    private readonly tasksService: TasksService, // answers "is this task yours?"
  ) {}

  // A task's checklist, top to bottom. Someone else's task gives "Task X not found".
  async findAll(taskId: number, ownerId: number): Promise<ChecklistItem[]> {
    await this.tasksService.findOwned(taskId, ownerId);
    return this.itemsInOrder(this.itemsRepository, taskId);
  }

  // New items go at the bottom
  async add(taskId: number, ownerId: number, text: string): Promise<ChecklistItem> {
    await this.tasksService.findOwned(taskId, ownerId);

    if ((await this.itemsRepository.countBy({ taskId })) >= MAX_CHECKLIST_ITEMS) {
      throw new BadRequestException(`A checklist can have at most ${MAX_CHECKLIST_ITEMS} items`);
    }
    const last = await this.itemsRepository.findOne({ where: { taskId }, order: { position: 'DESC' } });

    return this.itemsRepository.save(
      this.itemsRepository.create({ taskId, text, position: last ? last.position + 1 : 0 }),
    );
  }

  // Tick/untick and/or rename
  async update(id: number, ownerId: number, dto: UpdateChecklistItemDto): Promise<ChecklistItem> {
    if (dto.text === null || dto.done === null) {
      throw new BadRequestException('text and done cannot be null');
    }
    const item = await this.findOwned(this.itemsRepository, id, ownerId);
    this.itemsRepository.merge(item, dto);
    return this.itemsRepository.save(item);
  }

  // Same idea as moving a task: take it out, put it back at `position`, renumber 0, 1, 2...
  // Returns the whole checklist in its new order.
  async move(id: number, ownerId: number, position: number): Promise<ChecklistItem[]> {
    return this.itemsRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ChecklistItem);
      const item = await this.findOwned(repo, id, ownerId);

      const list = (await this.itemsInOrder(repo, item.taskId)).filter((i) => i.id !== id);
      list.splice(Math.min(Math.max(position, 0), list.length), 0, item);
      list.forEach((i, index) => { i.position = index; });
      return repo.save(list);
    });
  }

  async remove(id: number, ownerId: number): Promise<void> {
    const item = await this.findOwned(this.itemsRepository, id, ownerId);
    await this.itemsRepository.delete({ id: item.id });
  }

  // An item on one of YOUR tasks. The where on task.ownerId makes TypeORM join the tasks table,
  // so an item on someone else's task looks exactly like an item that doesn't exist.
  private async findOwned(repo: Repository<ChecklistItem>, id: number, ownerId: number): Promise<ChecklistItem> {
    const item = await repo.findOne({ where: { id, task: { ownerId } } });
    if (!item) throw new NotFoundException(`Checklist item ${id} not found`);
    return item;
  }

  private itemsInOrder(repo: Repository<ChecklistItem>, taskId: number): Promise<ChecklistItem[]> {
    return repo.find({ where: { taskId }, order: { position: 'ASC', id: 'ASC' } });
  }
}
