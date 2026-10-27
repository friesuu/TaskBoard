import { Module } from '@nestjs/common';
import { TasksModule } from './tasks/tasks.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { BoardsModule } from './boards/boards.module';
import type { Request, Response } from 'express';
import { ThrottlerModule } from '@nestjs/throttler';
import { migrations } from './migrations';
import { ChecklistModule } from './checklist/checklist.module';
import { CommentsModule } from './comments/comments.module';
import { LabelsModule } from './labels/labels.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AccountModule } from './account/account.module';
import { RunnerModule } from './runner/runner.module';
import { NotificationsModule } from './notifications/notifications.module';

// NODE_ENV=production is set on the real server (see the deployment guide); locally it's unset
const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      context: ({ req, res }: { req: Request; res: Response }) => ({ req, res }),
      driver: ApolloDriver,
      // Locally: write the schema to a file so changes show up in git. In production: keep it in memory.
      autoSchemaFile: isProduction ? true : join(process.cwd(), 'src/schema.gql'),
      graphiql: !isProduction, // the in-browser query tool, only while developing
      introspection: !isProduction, // don't hand strangers a full map of the API
      includeStacktraceInErrorResponses: !isProduction, // never show file paths in production errors
    }),
    // Rate limits. Only operations marked with @UseGuards(GqlThrottlerGuard) are limited.
    // Default: 5 per minute (login, register, change password); the chat sets its own limit.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 5 }],
      errorMessage: 'Too many attempts. Please wait a minute and try again.',
      // The e2e tests log in many times per run; they switch limits off (test/setup-env.ts)
      skipIf: () => process.env.DISABLE_RATE_LIMIT === 'true',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DB_HOST'),
        port: Number(config.getOrThrow('DB_PORT')),
        username: config.getOrThrow<string>('DB_USERNAME'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        autoLoadEntities: true,
        // Tables are changed only by migrations (src/migrations), never automatically:
        // synchronize could drop a column, and its data, when an entity changes.
        synchronize: false,
        migrations,
        migrationsRun: true, // on startup, apply any migration this database hasn't had yet
        logging: isProduction ? ['error'] : true, // every SQL query locally; only errors in production
      }),
    }),
    TasksModule,
    AuthModule,
    ChatModule,
    BoardsModule,
    ChecklistModule,
    CommentsModule,
    LabelsModule,
    AttachmentsModule,
    AccountModule,
    RunnerModule,
    NotificationsModule
  ],
})
export class AppModule {}
