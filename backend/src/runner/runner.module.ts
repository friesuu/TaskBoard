import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RunnerToken } from './runner-token.entity';
import { Task } from '../tasks/task.entity';
import { TaskComment } from '../comments/task-comment.entity';
import { ChecklistItem } from '../checklist/checklist-item.entity';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { BoardsModule } from '../boards/boards.module';
import { RunnerTokensService } from './runner-tokens.service';
import { RunnerAuthGuard } from './runner-auth.guard';
import { RunnerTokenResolver } from './runner-token.resolver';
import { PromptReviewService } from './prompt-review.service';
import { PromptReviewResolver } from './prompt-review.resolver';
import { RunnerService } from './runner.service';
import { RunnerResolver } from './runner.resolver';

// The Claude runner, as seen from the task board:
//   - the runner token (profile page) and the guard that checks it
//   - your review of Claude's prompts (task panel)
//   - the runner's own API: next job, save prompt, start and finish a build, report a problem
@Module({
  imports: [
    TypeOrmModule.forFeature([RunnerToken, Task, TaskComment, ChecklistItem]),
    AuthModule, // GqlAuthGuard, for your side
    TasksModule, // findOwned / move
    BoardsModule, // the board's project
  ],
  providers: [
    RunnerTokensService,
    RunnerAuthGuard,
    RunnerTokenResolver,
    PromptReviewService,
    PromptReviewResolver,
    RunnerService,
    RunnerResolver,
  ],
})
export class RunnerModule {}
