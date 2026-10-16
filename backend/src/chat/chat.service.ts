import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMessage } from './chat-message.entity';
import { LlmService } from './llm.service';
import { TasksService } from '../tasks/tasks.service';
import { Task } from '../tasks/task.entity';
import { taskTools } from './task-tools';

const MEMORY_SIZE = 20; // how many earlier messages Claude "remembers"

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly messagesRepository: Repository<ChatMessage>,
    private readonly tasksService: TasksService,
    private readonly llmService: LlmService,
  ) {}

  // The whole conversation, oldest first (for the screen)
  history(ownerId: number): Promise<ChatMessage[]> {
    return this.messagesRepository.find({ where: { ownerId }, order: { id: 'ASC' } });
  }

  async send(ownerId: number, text: string): Promise<ChatMessage> {
    // 1. Memory: the last MEMORY_SIZE messages, oldest first
    const recent = await this.messagesRepository.find({
      where: { ownerId },
      order: { id: 'DESC' },
      take: MEMORY_SIZE,
    });

    recent.reverse();
    // Claude needs the conversation to start with a user message
    while (recent.length > 0 && recent[0].role === 'assistant') recent.shift();

    // 2. Context: your tasks right now (attached to this message only, never saved)
    const tasks = await this.tasksService.findAll(ownerId);
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const context = `<my_tasks>\nToday is ${today}.\n${describeTasks(tasks)}\n</my_tasks>\n\n`;

    // 3. Ask Claude: memory + the new message
    const answer = await this.llmService.reply([
      ...recent.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: context + text },],
      taskTools(this.tasksService, ownerId), // built for THIS user only  
    );

    // 4. Save both only now, so a failed request leaves no half-finished turn behind
    const [, saved] = await this.messagesRepository.save([
      this.messagesRepository.create({ ownerId, role: 'user', content: text }),
      this.messagesRepository.create({ ownerId, role: 'assistant', content: answer }),
    ]);

    
    return saved;
  }

  async clear(ownerId: number): Promise<void> {
    await this.messagesRepository.delete({ ownerId });
  }
}

// One line per task, e.g. "- [TODO] Pay invoice (due 2026-10-20): ask Tom"
function describeTasks(tasks: Task[]): string {
  if (tasks.length === 0) return 'No tasks yet.';
  return tasks
    .map((t) => `- #${t.id} [${t.status}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ''}${t.description ? `: ${t.description}` : ''}`)
    .join('\n');
}