import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { Task } from '../tasks/task.entity';
import { PromptReviewService } from './prompt-review.service';
import { PromptChangesDto, RefinedPromptDto } from './runner.dto';

// Your side of the Claude workflow (the "Claude" section of the task panel). Normal login cookie.
@UseGuards(GqlAuthGuard)
@Resolver(() => Task)
export class PromptReviewResolver {
  constructor(private readonly reviewService: PromptReviewService) {}

  @Mutation(() => Task)
  updateRefinedPrompt(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: RefinedPromptDto,
  ): Promise<Task> {
    return this.reviewService.editPrompt(taskId, user.id, input.prompt);
  }

  @Mutation(() => Task)
  approvePrompt(@CurrentUser() user: User, @Args('taskId', { type: () => Int }) taskId: number): Promise<Task> {
    return this.reviewService.approve(taskId, user.id);
  }

  @Mutation(() => Task)
  requestPromptChanges(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: PromptChangesDto,
  ): Promise<Task> {
    return this.reviewService.requestChanges(taskId, user.id, input.comment);
  }

  @Mutation(() => Task)
  retryAiTask(@CurrentUser() user: User, @Args('taskId', { type: () => Int }) taskId: number): Promise<Task> {
    return this.reviewService.retry(taskId, user.id);
  }
}
