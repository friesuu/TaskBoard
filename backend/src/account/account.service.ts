import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuthService } from '../auth/auth.service';
import { AttachmentsService } from '../attachments/attachments.service';

// The profile's account settings: the display name, and deleting the account.
// (The time zone stays in AuthService, where it already was.)
@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly authService: AuthService, // "is this the right password?"
    private readonly attachmentsService: AttachmentsService, // the account's stored files
  ) {}

  // The DTO has already trimmed and checked it. Empty = remove the name.
  async setDisplayName(user: User, displayName: string): Promise<User> {
    user.displayName = displayName === '' ? null : displayName;
    return this.usersRepository.save(user);
  }

  // Deletes the account and everything in it: boards, tasks, labels, checklists, comments, chat
  // (all ON DELETE CASCADE from the user) and the uploaded files.
  async deleteAccount(user: User, password: string): Promise<void> {
    // BadRequest, not Unauthorized: the frontend treats "unauthenticated" as "session expired" and logs you out
    if (!(await this.authService.checkPassword(user, password))) {
      throw new BadRequestException('Password is incorrect');
    }

    const fileKeys = await this.attachmentsService.storageKeysOwnedBy(user.id); // before the rows are gone
    await this.usersRepository.delete({ id: user.id });
    await this.attachmentsService.removeStoredFiles(fileKeys);
  }
}
