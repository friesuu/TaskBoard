import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Label } from './label.entity';
import { LabelsService } from './labels.service';
import { LabelsResolver } from './labels.resolver';
import { Task } from '../tasks/task.entity';
import { AuthModule } from '../auth/auth.module';
import { BoardsModule } from '../boards/boards.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Label, Task]), // labels, and tasks (to save which labels a task has)
    AuthModule, // for GqlAuthGuard
    BoardsModule, // for BoardsService.findOwned ("is this board yours?")
    TasksModule, // for TasksService.findOwned ("is this task yours?")
  ],
  providers: [LabelsService, LabelsResolver],
})
export class LabelsModule {}


// Providers are the classes that belong to this feature (label feature)
// Imports lists what this feature borrows fro elsewhere