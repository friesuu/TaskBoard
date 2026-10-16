import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { TaskComment } from './task-comment.entity';
import { CommentsService } from './comments.service';
import { CommentDto } from './comment.dto';

@UseGuards(GqlAuthGuard)
@Resolver(() => TaskComment)
export class CommentsResolver {
  constructor(private readonly commentsService: CommentsService) {}

  @Query(() => [TaskComment])
  comments(@CurrentUser() user: User, @Args('taskId', { type: () => Int }) taskId: number): Promise<TaskComment[]> {
    return this.commentsService.findAll(taskId, user.id);
  }

  @Mutation(() => TaskComment)
  addComment(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: CommentDto,
  ): Promise<TaskComment> {
    return this.commentsService.add(taskId, user.id, input.body);
  }

  @Mutation(() => TaskComment)
  updateComment(
    @CurrentUser() user: User,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: CommentDto,
  ): Promise<TaskComment> {
    return this.commentsService.update(id, user.id, input.body);
  }

  @Mutation(() => Boolean)
  async deleteComment(@CurrentUser() user: User, @Args('id', { type: () => Int }) id: number): Promise<boolean> {
    await this.commentsService.remove(id, user.id);
    return true;
  }
}
