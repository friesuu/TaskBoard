import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { Label } from './label.entity';
import { LabelsService } from './labels.service';
import { LabelDto, SetTaskLabelsDto, UpdateLabelDto } from './label.dto';
import { Task } from '../tasks/task.entity';

@UseGuards(GqlAuthGuard)
@Resolver(() => Label)
export class LabelsResolver {
  constructor(private readonly labelsService: LabelsService) {}

  @Query(() => [Label])
  labels(@CurrentUser() user: User, @Args('boardId', { type: () => Int }) boardId: number): Promise<Label[]> {
    return this.labelsService.findAll(boardId, user.id);
  }

  @Mutation(() => Label)
  createLabel(
    @CurrentUser() user: User,
    @Args('boardId', { type: () => Int }) boardId: number,
    @Args('input') input: LabelDto,
  ): Promise<Label> {
    return this.labelsService.create(boardId, user.id, input);
  }

  @Mutation(() => Label)
  updateLabel(
    @CurrentUser() user: User,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateLabelDto,
  ): Promise<Label> {
    return this.labelsService.update(id, user.id, input);
  }

  @Mutation(() => Boolean)
  async deleteLabel(@CurrentUser() user: User, @Args('id', { type: () => Int }) id: number): Promise<boolean> {
    await this.labelsService.remove(id, user.id);
    return true;
  }

  // Returns the task with its new labels
  @Mutation(() => Task)
  setTaskLabels(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: SetTaskLabelsDto,
  ): Promise<Task> {
    return this.labelsService.setTaskLabels(taskId, user.id, input.labelIds);
  }
}

// A class whose functions are called when an operation is called. Operation being mutations and queries
// It does no logic itself
// Just reads input and hands it over to the service

