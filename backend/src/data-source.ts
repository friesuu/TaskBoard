import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Task } from './tasks/task.entity';
import { User } from './users/user.entity';
import { ChatMessage } from './chat/chat-message.entity';
import { migrations } from './migrations';

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
  entities: [Task, User, ChatMessage], // add new entities here too
  migrations,
});
