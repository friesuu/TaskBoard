import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChecklistItem } from './checklist-item.entity';
import { ChecklistService } from './checklist.service';
import { ChecklistResolver } from './checklist.resolver';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChecklistItem]), // gives ChecklistService its repository
    AuthModule, // for GqlAuthGuard
    TasksModule, // for TasksService.findOwned ("is this task yours?")
  ],
  providers: [ChecklistService, ChecklistResolver],
})
export class ChecklistModule {}
