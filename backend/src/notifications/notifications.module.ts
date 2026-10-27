import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserNotification } from './notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsResolver } from './notifications.resolver';

// The bell in the header. The runner's side of the server (RunnerModule) adds the notifications.
@Module({
  imports: [TypeOrmModule.forFeature([UserNotification]), AuthModule],
  providers: [NotificationsService, NotificationsResolver],
  exports: [NotificationsService],
})
export class NotificationsModule {}
