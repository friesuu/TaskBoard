import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMessage } from './chat-message.entity';
import { ChatService } from './chat.service';
import { ChatResolver } from './chat.resolver';
import { LlmService } from './llm.service';
import { TasksModule } from '../tasks/tasks.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([ChatMessage]), TasksModule, AuthModule],
  providers: [ChatService, ChatResolver, LlmService],
})
export class ChatModule {}