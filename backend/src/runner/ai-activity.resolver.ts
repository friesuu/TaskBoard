import { BadRequestException, UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { AiActivityService } from './ai-activity.service';
import { AgentRun } from './agent-run.entity';
import { AgentRunLog } from './agent-run-log.entity';
import { AgentStatusInfo } from './agent-status.entity';

const RUN_STATUSES = ['running', 'succeeded', 'failed'];

// The AI Activity page. Normal login cookie; only ever your own runs.
@UseGuards(GqlAuthGuard)
@Resolver()
export class AiActivityResolver {
  constructor(private readonly activityService: AiActivityService) {}

  // What your runner is doing: working, idle, paused, unplugged, capped, offline, or never seen
  @Query(() => AgentStatusInfo)
  agentStatus(@CurrentUser() user: User): Promise<AgentStatusInfo> {
    return this.activityService.agentStatus(user.id);
  }

  // Your newest 100 runs on every board. status: running, succeeded or failed (none = all)
  @Query(() => [AgentRun])
  aiRuns(
    @CurrentUser() user: User,
    @Args('status', { type: () => String, nullable: true }) status?: string | null,
  ): Promise<AgentRun[]> {
    if (status && !RUN_STATUSES.includes(status)) {
      throw new BadRequestException(`status must be one of: ${RUN_STATUSES.join(', ')}`);
    }
    return this.activityService.activity(user.id, status ?? null);
  }

  // One run's step-by-step log
  @Query(() => [AgentRunLog])
  agentRunLog(@CurrentUser() user: User, @Args('runId', { type: () => Int }) runId: number): Promise<AgentRunLog[]> {
    return this.activityService.runLog(runId, user.id);
  }
}
