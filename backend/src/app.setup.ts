import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

export function setupApp(app: NestExpressApplication): void {
  // Which website may call this API with cookies. FRONTEND_URL is set on the real server.
  app.enableCors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173', credentials: true });
  // A request passed on by a program on this same computer (the Rust backend while it's being built,
  // or a web server like nginx) comes from 127.0.0.1. Believe its X-Forwarded-For header about who really
  // sent it, so rate limits count each person separately. From anywhere else the header is ignored.
  app.set('trust proxy', 'loopback');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.use(cookieParser());
}
