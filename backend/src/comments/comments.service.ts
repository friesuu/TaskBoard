import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskComment } from './task-comment.entity';
import { TasksService } from '../tasks/tasks.service';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(TaskComment)
    private readonly commentsRepository: Repository<TaskComment>,
    private readonly tasksService: TasksService, // answers "is this task yours?"
  ) {}

  // A task's comments, oldest first (the newest is at the bottom, like a chat), each with its author.
  // Only real comments: Claude's notes and your prompt feedback are in the AI tab.
  async findAll(taskId: number, userId: number): Promise<TaskComment[]> {
    await this.tasksService.findOwned(taskId, userId);
    return this.commentsRepository.find({
      where: { taskId, kind: 'comment' },
      relations: { author: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async add(taskId: number, userId: number, body: string): Promise<TaskComment> {
    await this.tasksService.findOwned(taskId, userId);
    const saved = await this.commentsRepository.save(
      this.commentsRepository.create({ taskId, authorId: userId, body }),
    );
    return this.findYours(saved.id, userId); // loaded again so it comes back with its author
  }

  async update(id: number, userId: number, body: string): Promise<TaskComment> {
    const comment = await this.findYours(id, userId);
    if (comment.kind === 'claude') throw new BadRequestException("Claude's comments can't be edited");
    if (comment.kind !== 'comment') throw new BadRequestException("Prompt feedback can't be edited");
    comment.body = body;
    return this.commentsRepository.save(comment);
  }

  async remove(id: number, userId: number): Promise<void> {
    const result = await this.commentsRepository.delete({ id, authorId: userId, kind: 'comment' });
    if (result.affected === 0) throw new NotFoundException(`Comment ${id} not found`);
  }

  // A comment YOU wrote. Anyone else's comment looks exactly like one that doesn't exist.
  private async findYours(id: number, userId: number): Promise<TaskComment> {
    const comment = await this.commentsRepository.findOne({
      where: { id, authorId: userId },
      relations: { author: true },
    });
    if (!comment) throw new NotFoundException(`Comment ${id} not found`);
    return comment;
  }
}
