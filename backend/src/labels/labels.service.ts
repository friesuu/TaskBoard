import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Label } from './label.entity';
import { LabelDto, UpdateLabelDto } from './label.dto';
import { BoardsService } from '../boards/boards.service';
import { TasksService } from '../tasks/tasks.service';
import { Task } from '../tasks/task.entity';

export const MAX_LABELS_PER_BOARD = 50;

@Injectable()
export class LabelsService {
  constructor(
    @InjectRepository(Label)
    private readonly labelsRepository: Repository<Label>,
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    private readonly boardsService: BoardsService, // "is this board yours?"
    private readonly tasksService: TasksService,   // "is this task yours?"
  ) {}

  // A board's labels, A to Z. Someone else's board gives "Board X not found".
  async findAll(boardId: number, ownerId: number): Promise<Label[]> {
    await this.boardsService.findOwned(boardId, ownerId);
    return this.labelsRepository.find({ where: { boardId }, order: { name: 'ASC', id: 'ASC' } });
  }

  async create(boardId: number, ownerId: number, dto: LabelDto): Promise<Label> {
    await this.boardsService.findOwned(boardId, ownerId);

    if ((await this.labelsRepository.countBy({ boardId })) >= MAX_LABELS_PER_BOARD) {
      throw new BadRequestException(`A board can have at most ${MAX_LABELS_PER_BOARD} labels`);
    }
    await this.checkNameFree(boardId, dto.name);

    return this.labelsRepository.save(this.labelsRepository.create({ ...dto, boardId }));
  }

  // Rename and/or recolour. Tasks that have the label show the change straight away (they only point at it).
  async update(id: number, ownerId: number, dto: UpdateLabelDto): Promise<Label> {
    if (dto.name === null || dto.color === null) {
      throw new BadRequestException('name and color cannot be null');
    }
    const label = await this.findOwned(id, ownerId);
    if (dto.name !== undefined && dto.name.toLowerCase() !== label.name.toLowerCase()) {
      await this.checkNameFree(label.boardId, dto.name);
    }

    this.labelsRepository.merge(label, dto);
    return this.labelsRepository.save(label);
  }

  // Also takes the label off every task that had it (the database does that: ON DELETE CASCADE)
  async remove(id: number, ownerId: number): Promise<void> {
    const label = await this.findOwned(id, ownerId);
    await this.labelsRepository.delete({ id: label.id });
  }

  // Replaces a task's labels. Every label must be on the task's own board,
  // so a task can never get a label from another board (or another user).
  async setTaskLabels(taskId: number, ownerId: number, labelIds: number[]): Promise<Task> {
    const task = await this.tasksService.findOwned(taskId, ownerId);
    const ids = [...new Set(labelIds)];
    const labels = ids.length > 0 ? await this.labelsRepository.findBy({ id: In(ids), boardId: task.boardId }) : [];
    if (labels.length !== ids.length) {
      throw new NotFoundException('Label not found on this board');
    }

    task.labels = labels;
    await this.tasksRepository.save(task);
    return this.tasksService.findOwned(taskId, ownerId); // fresh, with the labels in A-Z order
  }

  // A label on one of YOUR boards. Someone else's label looks exactly like one that doesn't exist.
  private async findOwned(id: number, ownerId: number): Promise<Label> {
    const label = await this.labelsRepository.findOne({ where: { id, board: { ownerId } } });
    if (!label) throw new NotFoundException(`Label ${id} not found`);
    return label;
  }

  // "Urgent" and "urgent" count as the same name
  private async checkNameFree(boardId: number, name: string): Promise<void> {
    const taken = await this.labelsRepository
      .createQueryBuilder('label')
      .where('label.board_id = :boardId', { boardId })
      .andWhere('LOWER(label.name) = LOWER(:name)', { name })
      .getExists();
    if (taken) throw new ConflictException(`There is already a label called "${name}" on this board`);
  }
}
