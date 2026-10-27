import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { NotificationKind, UserNotification } from './notification.entity';

const LATEST = 30; // how many the bell lists

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(UserNotification)
    private readonly notificationsRepository: Repository<UserNotification>,
  ) {}

  // Called by the runner's side of the server when something happens (see RunnerService, AiActivityService)
  async notify(userId: number, kind: NotificationKind, message: string, taskId: number | null = null): Promise<void> {
    await this.notificationsRepository.save(
      this.notificationsRepository.create({ userId, kind, message: message.slice(0, 200), taskId }),
    );
  }

  // Your newest notifications, newest first, each with its task's id, title and board
  findLatest(userId: number): Promise<UserNotification[]> {
    return this.withTask()
      .where('notification.userId = :userId', { userId })
      .orderBy('notification.createdAt', 'DESC')
      .addOrderBy('notification.id', 'DESC')
      .limit(LATEST)
      .getMany();
  }

  unreadCount(userId: number): Promise<number> {
    return this.notificationsRepository.count({ where: { userId, readAt: IsNull() } });
  }

  async markRead(id: number, userId: number): Promise<UserNotification> {
    const notification = await this.withTask()
      .where('notification.id = :id AND notification.userId = :userId', { id, userId })
      .getOne();
    if (!notification) throw new NotFoundException(`Notification ${id} not found`); // someone else's too
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationsRepository.update(notification.id, { readAt: notification.readAt });
    }
    return notification;
  }

  // Returns how many were marked
  async markAllRead(userId: number): Promise<number> {
    const result = await this.notificationsRepository.update({ userId, readAt: IsNull() }, { readAt: new Date() });
    return result.affected ?? 0;
  }

  // Only the task's id, title and board: all a notification needs to show it and link to it
  private withTask(): SelectQueryBuilder<UserNotification> {
    return this.notificationsRepository
      .createQueryBuilder('notification')
      .leftJoin('notification.task', 'task')
      .addSelect(['task.id', 'task.title', 'task.boardId']);
  }
}
