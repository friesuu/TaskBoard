import {
  BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import type { Readable } from 'stream';
import { Attachment } from './attachment.entity';
import { StorageService } from './storage.service';
import { checkFile, cleanFileName } from './file-types';
import { TasksService } from '../tasks/tasks.service';

export const MAX_ATTACHMENTS_PER_TASK = 20;
const CLEAN_UP_EVERY = 60 * 60 * 1000; // 1 hour
const CLEAN_UP_GRACE = 60 * 60 * 1000; // only files older than 1 hour (never one that's being uploaded right now)

// The parts of an uploaded file we use (what the upload library hands the controller)
export interface UploadedFileData {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class AttachmentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentsService.name);
  private cleanUpTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentsRepository: Repository<Attachment>,
    private readonly storage: StorageService,
    private readonly tasksService: TasksService, // "is this task yours?"
  ) {}

  // A task's files, oldest first. Someone else's task gives "Task X not found".
  async findAll(taskId: number, ownerId: number): Promise<Attachment[]> {
    await this.tasksService.findOwned(taskId, ownerId);
    return this.attachmentsRepository.find({ where: { taskId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }

  async upload(taskId: number, ownerId: number, file: UploadedFileData | undefined): Promise<Attachment> {
    await this.tasksService.findOwned(taskId, ownerId);
    if (!file) throw new BadRequestException('No file was sent (it goes in a form field called "file")');
    if ((await this.attachmentsRepository.countBy({ taskId })) >= MAX_ATTACHMENTS_PER_TASK) {
      throw new BadRequestException(`A task can have at most ${MAX_ATTACHMENTS_PER_TASK} files`);
    }

    const fileName = cleanFileName(file.originalname);
    const { mimeType } = checkFile(fileName, file.buffer); // throws if the type isn't allowed or doesn't match

    // A random name in storage: never the uploaded name, so it can't be guessed or misused
    const storageKey = randomBytes(32).toString('hex');
    await this.storage.save(storageKey, file.buffer);
    try {
      return await this.attachmentsRepository.save(
        this.attachmentsRepository.create({ taskId, fileName, mimeType, size: file.size, storageKey }),
      );
    } catch (err) {
      await this.storage.remove(storageKey); // the row couldn't be saved: don't leave the file behind
      throw err;
    }
  }

  // For a download: the attachment (if it's on one of YOUR tasks) and its bytes.
  // Someone else's file looks exactly like one that doesn't exist.
  async openForDownload(id: number, ownerId: number): Promise<{ attachment: Attachment; content: Readable }> {
    const attachment = await this.findOwned(id, ownerId);
    return { attachment, content: this.storage.open(attachment.storageKey) };
  }

  async remove(id: number, ownerId: number): Promise<void> {
    const attachment = await this.findOwned(id, ownerId);
    await this.attachmentsRepository.delete({ id: attachment.id });
    await this.storage.remove(attachment.storageKey);
  }

  // Where every file on one user's tasks is stored. Deleting an account asks for these first: the rows
  // go with the account (ON DELETE CASCADE), and the files are deleted right after with removeStoredFiles.
  async storageKeysOwnedBy(ownerId: number): Promise<string[]> {
    const rows = await this.attachmentsRepository.find({ where: { task: { ownerId } }, select: { storageKey: true } });
    return rows.map((a) => a.storageKey);
  }

  // Deletes stored files. One that can't be deleted now is left for the hourly clean-up below.
  async removeStoredFiles(keys: string[]): Promise<void> {
    await Promise.allSettled(keys.map((key) => this.storage.remove(key)));
  }

  // Deleting a task (or a board) deletes its attachment ROWS in the database (ON DELETE CASCADE),
  // but the database can't delete files. This finds stored files that no row points at any more and deletes them.
  // Runs when the app starts and then every hour. Returns how many files it deleted.
  async removeOrphanFiles(): Promise<number> {
    const stored = await this.storage.list();
    const old = stored.filter((f) => Date.now() - f.modifiedAt.getTime() > CLEAN_UP_GRACE);
    if (old.length === 0) return 0;

    const known = await this.attachmentsRepository.find({
      where: { storageKey: In(old.map((f) => f.key)) },
      select: { storageKey: true },
    });
    const knownKeys = new Set(known.map((a) => a.storageKey));
    const orphans = old.filter((f) => !knownKeys.has(f.key));
    await Promise.all(orphans.map((f) => this.storage.remove(f.key)));
    return orphans.length;
  }

  onModuleInit(): void {
    const cleanUp = () => {
      this.removeOrphanFiles()
        .then((count) => { if (count > 0) this.logger.log(`Deleted ${count} file(s) of deleted tasks`); })
        .catch((err: Error) => this.logger.warn(`File clean-up failed: ${err.message}`));
    };
    cleanUp();
    // ATTACHMENT_CLEANUP_EVERY_MS: only the e2e tests set it (e2e.env), so they don't wait an hour
    this.cleanUpTimer = setInterval(cleanUp, Number(process.env.ATTACHMENT_CLEANUP_EVERY_MS) || CLEAN_UP_EVERY);
    this.cleanUpTimer.unref(); // doesn't keep the app (or the tests) running on its own
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanUpTimer);
  }

  private async findOwned(id: number, ownerId: number): Promise<Attachment> {
    const attachment = await this.attachmentsRepository.findOne({ where: { id, task: { ownerId } } });
    if (!attachment) throw new NotFoundException(`Attachment ${id} not found`);
    return attachment;
  }
}
