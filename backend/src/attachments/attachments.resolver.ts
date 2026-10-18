import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { Attachment } from './attachment.entity';
import { AttachmentsService } from './attachments.service';

// Listing and deleting files. (Uploading and downloading are in attachments.controller.ts.)
@UseGuards(GqlAuthGuard)
@Resolver(() => Attachment)
export class AttachmentsResolver {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Query(() => [Attachment])
  attachments(@CurrentUser() user: User, @Args('taskId', { type: () => Int }) taskId: number): Promise<Attachment[]> {
    return this.attachmentsService.findAll(taskId, user.id);
  }

  // Deletes the row and the stored file
  @Mutation(() => Boolean)
  async deleteAttachment(@CurrentUser() user: User, @Args('id', { type: () => Int }) id: number): Promise<boolean> {
    await this.attachmentsService.remove(id, user.id);
    return true;
  }
}
