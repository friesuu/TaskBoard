import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { ChecklistItem } from './checklist-item.entity';
import { ChecklistService } from './checklist.service';
import { ChecklistItemDto, UpdateChecklistItemDto } from './checklist-item.dto';

@UseGuards(GqlAuthGuard)
@Resolver(() => ChecklistItem)
export class ChecklistResolver {
  constructor(private readonly checklistService: ChecklistService) {}

  @Query(() => [ChecklistItem])
  checklistItems(@CurrentUser() user: User, @Args('taskId', { type: () => Int }) taskId: number): Promise<ChecklistItem[]> {
    return this.checklistService.findAll(taskId, user.id);
  }

  @Mutation(() => ChecklistItem)
  addChecklistItem(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: ChecklistItemDto,
  ): Promise<ChecklistItem> {
    return this.checklistService.add(taskId, user.id, input.text);
  }

  @Mutation(() => ChecklistItem)
  updateChecklistItem(
    @CurrentUser() user: User,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateChecklistItemDto,
  ): Promise<ChecklistItem> {
    return this.checklistService.update(id, user.id, input);
  }

  // position 0 = top; a number past the end = bottom
  @Mutation(() => [ChecklistItem])
  moveChecklistItem(
    @CurrentUser() user: User,
    @Args('id', { type: () => Int }) id: number,
    @Args('position', { type: () => Int }) position: number,
  ): Promise<ChecklistItem[]> {
    return this.checklistService.move(id, user.id, position);
  }

  @Mutation(() => Boolean)
  async deleteChecklistItem(@CurrentUser() user: User, @Args('id', { type: () => Int }) id: number): Promise<boolean> {
    await this.checklistService.remove(id, user.id);
    return true;
  }
}
