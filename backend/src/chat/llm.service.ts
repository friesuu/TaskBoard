import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';

const CHAT_MODEL = 'claude-sonnet-5-5';

const SYSTEM_PROMPT = `You are the assistant inside a personal task board app.
Help the user plan, prioritise and manage their own tasks.
Their current tasks (in board order, with ids like #12) and today's date are in <my_tasks> tags at the start of their latest message.
You can create, edit and move tasks with your tools, but only when the user asks for a change. Use the ids from <my_tasks>.
You cannot delete tasks: if asked, tell the user to use the bin icon on the card.
After changing something, say in one short sentence what you changed.
Answer briefly in plain text without Markdown, because the chat shows text exactly as written.`;

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: Anthropic;

  constructor(config: ConfigService) {
    // getOrThrow: the server refuses to start without a key (same as JWT_SECRET)
    this.client = new Anthropic({ apiKey: config.getOrThrow<string>('ANTHROPIC_API_KEY') });
  }

  // Sends the conversation to Claude, returns Claude's answer as text
  async reply(messages: Anthropic.Beta.BetaMessageParam[], tools: BetaRunnableTool<any>[] = []): Promise<string> {
    try {
      // toolRunner = messages.create + the tool loop: whenever Claude asks for a tool,
      // the SDK runs that tool's run() and sends the result back, until Claude writes its answer
      const response = await this.client.beta.messages.toolRunner({
        model: CHAT_MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages,
        tools,
        max_iterations: 5, // at most 5 requests to Claude per chat message, which caps the cost
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });

      if (response.stop_reason === 'refusal') return "Sorry, I can't help with that.";

      if (response.stop_reason === 'tool_use') {
        return 'That took too many steps, so I stopped. Some changes may already be made; please check the board.';
      }

      // The answer arrives as a list of blocks; keep only the text ones
      let text = '';
      for (const block of response.content) {
        if (block.type === 'text') text += block.text;
      }
      return text || "Sorry, I couldn't come up with an answer.";
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        throw new ServiceUnavailableException('The assistant is busy. Try again in a minute.');
      }
      if (error instanceof Anthropic.APIError) {
        // e.g. 401 = wrong key in .env. Logged for you, never shown to the user.
        this.logger.error(`Claude API error ${error.status}: ${error.message}`);
        throw new ServiceUnavailableException('The assistant is unavailable right now.');
      }
      throw error;
    }
  }
}