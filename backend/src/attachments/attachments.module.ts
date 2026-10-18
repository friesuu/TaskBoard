import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from './attachment.entity';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsResolver } from './attachments.resolver';
import { LocalDiskStorage, StorageService } from './storage.service';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Attachment]), // gives AttachmentsService its repository
    AuthModule, // for the login guards
    TasksModule, // for TasksService.findOwned ("is this task yours?")
  ],
  controllers: [AttachmentsController], // upload and download (normal web addresses)
  providers: [
    AttachmentsService,
    AttachmentsResolver, // list and delete (GraphQL)
    // Whoever asks for StorageService gets the local-disk version. For cloud storage, swap the class here.
    { provide: StorageService, useClass: LocalDiskStorage },
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
