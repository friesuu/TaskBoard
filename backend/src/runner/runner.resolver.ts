import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { Task } from '../tasks/task.entity';
import { RunnerAuthGuard } from './runner-auth.guard';
import { RunnerService } from './runner.service';
import { RunnerJob } from './runner-job.type';
import { RunnerBuildResultDto, RunnerBuildStartDto, RunnerErrorDto, RunnerPromptDto, RunnerRunLogDto } from './runner.dto';

// The runner's own GraphQL operations. Only its token gets in here (RunnerAuthGuard),
// and its token gets nowhere else.
@UseGuards(RunnerAuthGuard)
@Resolver()
export class RunnerResolver {
  constructor(private readonly runnerService: RunnerService) {}

  // The runner's start-up check: "is my token valid?"
  @Query(() => Boolean)
  runnerPing(): boolean {
    return true;
  }

  @Query(() => RunnerJob, { nullable: true })
  runnerNextJob(@CurrentUser() user: User): Promise<RunnerJob | null> {
    return this.runnerService.nextJob(user.id);
  }

  @Mutation(() => Task)
  runnerSavePrompt(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: RunnerPromptDto,
  ): Promise<Task> {
    return this.runnerService.savePrompt(taskId, user.id, input.prompt);
  }

  @Mutation(() => Task)
  runnerStartBuild(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: RunnerBuildStartDto,
  ): Promise<Task> {
    return this.runnerService.startBuild(taskId, user.id, input.branch);
  }

  @Mutation(() => Task)
  runnerFinishBuild(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: RunnerBuildResultDto,
  ): Promise<Task> {
    return this.runnerService.finishBuild(taskId, user.id, input.summary);
  }

  @Mutation(() => Boolean)
  async runnerLogRun(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: RunnerRunLogDto,
  ): Promise<boolean> {
    await this.runnerService.logRun(taskId, user.id, input);
    return true;
  }

  @Mutation(() => Task)
  runnerReportError(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: RunnerErrorDto,
  ): Promise<Task> {
    return this.runnerService.reportError(taskId, user.id, input.message);
  }
}
