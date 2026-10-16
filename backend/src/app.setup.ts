import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

export function setupApp(app: INestApplication): void {
  // Which website may call this API with cookies. FRONTEND_URL is set on the real server.
  app.enableCors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173', credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.use(cookieParser());
}
