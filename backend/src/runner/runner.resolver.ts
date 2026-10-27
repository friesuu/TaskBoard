import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { RunnerAuthGuard } from './runner-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { Task } from '../tasks/task.entity';
import { RunnerService } from './runner.service';
import { AiActivityService } from './ai-activity.service';
import { RunnerJob, RunnerJobKind } from './runner-job.type';
import {
  RunnerBuildResultDto, RunnerBuildStartDto, RunnerErrorDto, RunnerLogInputDto, RunnerPromptDto,
  RunnerRunFinishDto, RunnerRunStartDto, RunnerStatusDto,
} from './runner.dto';

// The runner's own GraphQL operations. Only its token gets in here (RunnerAuthGuard),
// and its token gets nowhere else.
@UseGuards(RunnerAuthGuard)
@Resolver()
export class RunnerResolver {
  constructor(
    private readonly runnerService: RunnerService,
    private readonly activityService: AiActivityService,
  ) {}

  // The runner's start-up check: "is my token valid?"
  @Query(() => Boolean)
  runnerPing(): boolean {
    return true;
  }

  // kinds: the jobs this runner can do (left out by runners from before MERGE existed)
  @Query(() => RunnerJob, { nullable: true })
  runnerNextJob(
    @CurrentUser() user: User,
    @Args('kinds', { type: () => [RunnerJobKind], nullable: true }) kinds?: RunnerJobKind[],
  ): Promise<RunnerJob | null> {
    return this.runnerService.nextJob(user.id, kinds ?? undefined);
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
    return this.runnerService.finishBuild(taskId, user.id, input.checksPassed);
  }

  @Mutation(() => Task)
  runnerFinishMerge(@CurrentUser() user: User, @Args('taskId', { type: () => Int }) taskId: number): Promise<Task> {
    return this.runnerService.finishMerge(taskId, user.id);
  }

  @Mutation(() => Task)
  runnerReportError(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: RunnerErrorDto,
  ): Promise<Task> {
    return this.runnerService.reportError(taskId, user.id, input.message);
  }

  // ----- The runner's activity: its runs, their step-by-step logs, and what it's doing now -----

  // A step starts. Returns the run's id, for the log lines and the finish.
  @Mutation(() => Int)
  async runnerStartRun(
    @CurrentUser() user: User,
    @Args('taskId', { type: () => Int }) taskId: number,
    @Args('input') input: RunnerRunStartDto,
  ): Promise<number> {
    return (await this.activityService.startRun(taskId, user.id, input.step, input.branch ?? null)).id;
  }

  @Mutation(() => Boolean)
  runnerAppendLog(
    @CurrentUser() user: User,
    @Args('runId', { type: () => Int }) runId: number,
    @Args('input') input: RunnerLogInputDto,
  ): Promise<boolean> {
    return this.activityService.appendLog(runId, user.id, input.lines);
  }

  @Mutation(() => Boolean)
  async runnerFinishRun(
    @CurrentUser() user: User,
    @Args('runId', { type: () => Int }) runId: number,
    @Args('input') input: RunnerRunFinishDto,
  ): Promise<boolean> {
    await this.activityService.finishRun(runId, user.id, input);
    return true;
  }

  @Mutation(() => Boolean)
  async runnerReportStatus(@CurrentUser() user: User, @Args('input') input: RunnerStatusDto): Promise<boolean> {
    await this.activityService.reportStatus(user.id, input);
    return true;
  }
}
