import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskComment } from './task-comment.entity';
import { CommentsService } from './comments.service';
import { CommentsResolver } from './comments.resolver';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskComment]), // gives CommentsService its repository
    AuthModule, // for GqlAuthGuard
    TasksModule, // for TasksService.findOwned ("is this task yours?")
  ],
  providers: [CommentsService, CommentsResolver],
})
export class CommentsModule {}
