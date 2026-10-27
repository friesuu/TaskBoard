import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { UserNotification } from './notification.entity';
import { NotificationsService } from './notifications.service';

// The header's bell. Normal login cookie; only ever your own notifications.
@UseGuards(GqlAuthGuard)
@Resolver(() => UserNotification)
export class NotificationsResolver {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Your newest 30, newest first
  @Query(() => [UserNotification])
  notifications(@CurrentUser() user: User): Promise<UserNotification[]> {
    return this.notificationsService.findLatest(user.id);
  }

  @Query(() => Int)
  unreadNotificationCount(@CurrentUser() user: User): Promise<number> {
    return this.notificationsService.unreadCount(user.id);
  }

  @Mutation(() => UserNotification)
  markNotificationRead(@CurrentUser() user: User, @Args('id', { type: () => Int }) id: number): Promise<UserNotification> {
    return this.notificationsService.markRead(id, user.id);
  }

  // Returns how many were marked
  @Mutation(() => Int)
  markAllNotificationsRead(@CurrentUser() user: User): Promise<number> {
    return this.notificationsService.markAllRead(user.id);
  }
}
