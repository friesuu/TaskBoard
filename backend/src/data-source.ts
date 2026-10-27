import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Task } from './tasks/task.entity';
import { User } from './users/user.entity';
import { ChatMessage } from './chat/chat-message.entity';
import { Board } from './boards/board.entity';
import { migrations } from './migrations';
import { ChecklistItem } from './checklist/checklist-item.entity';
import { TaskComment } from './comments/task-comment.entity';
import { Label } from './labels/label.entity';
import { Attachment } from './attachments/attachment.entity';
import { RunnerToken } from './runner/runner-token.entity';
import { AgentRun } from './runner/agent-run.entity';
import { AgentRunLog } from './runner/agent-run-log.entity';
import { AgentStatus } from './runner/agent-status.entity';
import { UserNotification } from './notifications/notification.entity';

// Used only by the TypeORM command line (npm run migration:generate / :run / :revert / :show).
// It runs outside Nest, so it reads .env itself. Values already set in the environment win,
// which is how a server (or a one-off command) can point it at another database.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file (e.g. on a server): the real environment variables are used
}

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [Task, User, ChatMessage, Board, ChecklistItem, TaskComment, Label, Attachment, RunnerToken, AgentRun, AgentRunLog, AgentStatus, UserNotification], // add new entities here too
  migrations,
});
