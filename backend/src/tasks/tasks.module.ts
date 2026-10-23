import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './task.entity';
import { TaskResolver } from './tasks.resolver';
import { AuthModule } from '../auth/auth.module';
import { BoardsModule } from '../boards/boards.module';

@Module({
  imports: [TypeOrmModule.forFeature([Task]), AuthModule, BoardsModule],
  // imports: [Task, AuthModule, BoardsModule],
  providers: [TasksService, TaskResolver],
  exports: [TasksService],
})
export class TasksModule {}
