import { createServer, type Server } from 'http';

// Stands in for the Claude API in these tests: no real calls, no cost. The backend is pointed at it with
// ANTHROPIC_BASE_URL (e2e.env), so it's reached over HTTP like the real API, whichever backend is tested.
// It remembers every request, so a test can check what the assistant was shown, and a test can tell it
// what to answer next, e.g. "use the create_task tool with this input".

type Block = { type: string; [key: string]: unknown };
type Message = { role: string; content: string | Block[] };
export type ClaudeRequest = { model: string; messages: Message[]; tools?: { name: string }[] };

export class FakeClaude {
  requests: ClaudeRequest[] = []; // every request, oldest first
  delayMs = 0; // how long it "thinks" before answering (for the response time test)
  private answers: Block[][] = []; // answers to give, in order; when none are left: "Fake answer"
  private server?: Server;
  private toolUses = 0;

  start(port: number): Promise<void> {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        // POST /v1/messages (with ?beta=true for beta features): the only thing the backend asks for
        if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: req.url } }));
          return;
        }
        const request = JSON.parse(body) as ClaudeRequest;
        this.requests.push(request);
        const content = this.answers.shift() ?? [{ type: 'text', text: 'Fake answer' }];
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            id: `msg_fake_${this.requests.length}`,
            type: 'message',
            role: 'assistant',
            model: request.model,
            content,
            // tool_use: the backend runs the tool and sends its result back; end_turn: the answer is done
            stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }));
        }, this.delayMs);
      });
    });
    return new Promise((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '127.0.0.1', () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  // The next answer asks the backend to run one of its tools; the one after it ends the turn
  willUseTool(name: string, input: Record<string, unknown>): void {
    this.toolUses += 1;
    this.answers.push(
      [{ type: 'tool_use', id: `toolu_fake_${this.toolUses}`, name, input }],
      [{ type: 'text', text: 'Done.' }],
    );
  }

  // What the user's newest chat message looked like to Claude: the <my_tasks> context, then their text
  lastPrompt(): string {
    for (const request of [...this.requests].reverse()) {
      const last = request.messages.at(-1);
      if (last?.role === 'user' && typeof last.content === 'string') return last.content;
    }
    throw new Error('The fake Claude has not been sent a chat message');
  }

  // The tools the backend offered Claude in its newest request
  lastToolNames(): string[] {
    return (this.requests.at(-1)?.tools ?? []).map((t) => t.name);
  }

  // What the backend sent back after running the tool from willUseTool: the tool's answer, or its error
  lastToolResult(): { text: string; isError: boolean } {
    const last = this.requests.at(-1)?.messages.at(-1);
    const result = Array.isArray(last?.content) ? last.content.find((b) => b.type === 'tool_result') : undefined;
    if (!result) throw new Error('The backend did not send a tool result: did the chat message fail?');
    const content = result.content as string | { type: string; text?: string }[];
    const text = typeof content === 'string' ? content : content.map((b) => b.text ?? '').join('');
    return { text, isError: result.is_error === true };
  }

  // Forget everything: each test starts with no requests and no answers waiting
  reset(): void {
    this.requests = [];
    this.answers = [];
    this.delayMs = 0;
  }
}
