import {
  Controller, Get, Header, Param, ParseIntPipe, Post, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { HttpAuthGuard } from '../auth/http-auth.guard';
import { User } from '../users/user.entity';
import { AttachmentsService, type UploadedFileData } from './attachments.service';
import { Attachment } from './attachment.entity';
import { MAX_FILE_SIZE } from './file-types';

type LoggedInRequest = Request & { user: User };

// What the upload answers with. GraphQL only sends fields marked @Field, but a normal address would send
// the whole row, including the secret storage key: so we pick the public fields by hand.
type PublicAttachment = Pick<Attachment, 'id' | 'fileName' | 'mimeType' | 'size' | 'createdAt' | 'taskId'>;
const toPublic = ({ id, fileName, mimeType, size, createdAt, taskId }: Attachment): PublicAttachment =>
  ({ id, fileName, mimeType, size, createdAt, taskId });

// Files travel through normal web addresses, not GraphQL (GraphQL is awkward with files).
// Listing and deleting files are in GraphQL (attachments.resolver.ts) like everything else.
// The guards run first: no login = 401 before the upload is even read.
@Controller('api')
@UseGuards(HttpAuthGuard, ThrottlerGuard)
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  // Upload one file (form field "file") to a task. At most 10 MB, and 30 uploads a minute.
  @Post('tasks/:taskId/attachments')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  // No folder given, so the upload is kept in memory until it's been checked; only then is it stored.
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_FILE_SIZE, files: 1 }, // bigger: 413 Payload Too Large
  }))
  async upload(
    @Req() req: LoggedInRequest,
    @Param('taskId', ParseIntPipe) taskId: number,
    @UploadedFile() file: UploadedFileData | undefined,
  ): Promise<PublicAttachment> {
    return toPublic(await this.attachmentsService.upload(taskId, req.user.id, file));
  }

  // Download a file. Always as a download (never shown in the browser), and nosniff tells the browser
  // to believe our Content-Type instead of guessing, so a file can never be run as a web page.
  @Get('attachments/:id/download')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  async download(@Req() req: LoggedInRequest, @Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
    const { attachment, content } = await this.attachmentsService.openForDownload(id, req.user.id);
    return new StreamableFile(content, {
      type: attachment.mimeType,
      length: attachment.size,
      disposition: contentDisposition(attachment.fileName),
    });
  }
}

// "attachment; filename=..." in the form every browser understands, including non-English names:
// a plain-ASCII fallback, plus the exact UTF-8 name (filename*)
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
