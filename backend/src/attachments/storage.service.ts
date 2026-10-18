import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'fs';
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import type { Readable } from 'stream';

// Where uploaded files' bytes live. The rest of the app only uses these four methods, so moving to
// cloud storage later (S3, Azure Blob...) means writing one new class like LocalDiskStorage below
// and changing one line in attachments.module.ts. Nothing else changes.
export abstract class StorageService {
  abstract save(key: string, data: Buffer): Promise<void>;
  abstract open(key: string): Readable;
  abstract remove(key: string): Promise<void>;
  // Every stored file, with when it was written (used to clean up files nobody points at any more)
  abstract list(): Promise<{ key: string; modifiedAt: Date }[]>;
}

// Keys are random: 64 hex characters (see AttachmentsService). Anything else is refused,
// so a key can never point outside the upload folder (e.g. "../../.env").
const KEY_PATTERN = /^[a-f0-9]{64}$/;

// Development storage: a folder on this computer (UPLOAD_DIR in .env, default "uploads").
@Injectable()
export class LocalDiskStorage extends StorageService {
  private readonly folder: string;

  constructor(config: ConfigService) {
    super();
    this.folder = resolve(config.get<string>('UPLOAD_DIR') ?? 'uploads');
  }

  async save(key: string, data: Buffer): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    await writeFile(this.pathOf(key), data, { flag: 'wx' }); // 'wx': never overwrite an existing file
  }

  open(key: string): Readable {
    return createReadStream(this.pathOf(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true }); // force: already gone is fine
  }

  async list(): Promise<{ key: string; modifiedAt: Date }[]> {
    let names: string[];
    try {
      names = await readdir(this.folder);
    } catch {
      return []; // the folder doesn't exist yet: nothing uploaded
    }
    const keys = names.filter((name) => KEY_PATTERN.test(name));
    return Promise.all(keys.map(async (key) => ({ key, modifiedAt: (await stat(this.pathOf(key))).mtime })));
  }

  private pathOf(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
    return join(this.folder, key);
  }
}
