import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AccountService } from './account.service';
import { AccountResolver } from './account.resolver';

// Profile settings that change the account itself: display name and delete account
@Module({
  imports: [
    TypeOrmModule.forFeature([User]), // AccountService's users repository
    AuthModule, // the login guard, and checking the password
    AttachmentsModule, // deleting the account's uploaded files
  ],
  providers: [AccountService, AccountResolver],
})
export class AccountModule {}
