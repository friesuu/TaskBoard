import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMessage } from './chat-message.entity';
import { ChatService } from './chat.service';
import { ChatResolver } from './chat.resolver';
import { LlmService } from './llm.service';
import { TasksModule } from '../tasks/tasks.module';
import { AuthModule } from '../auth/auth.module';
import { BoardsModule } from '../boards/boards.module';
import { CommentsModule } from '../comments/comments.module';
import { RunnerModule } from '../runner/runner.module';
import { LabelsModule } from '../labels/labels.module';
import { ChecklistModule } from '../checklist/checklist.module';

@Module({
  imports: [TypeOrmModule.forFeature([ChatMessage]), TasksModule, AuthModule, BoardsModule, CommentsModule, RunnerModule, LabelsModule, ChecklistModule],
  providers: [ChatService, ChatResolver, LlmService],
})
export class ChatModule {}