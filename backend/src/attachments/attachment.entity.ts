import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Task } from '../tasks/task.entity';

// A file attached to a task. The bytes are in storage (see storage.service.ts); this row describes them.
@ObjectType()
@Entity('attachments')
@Index(['taskId', 'createdAt']) // always loaded as "this task's files, oldest first"
export class Attachment {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  // The name it was uploaded with (cleaned up), shown in the list and used for the download
  @Field()
  @Column({ name: 'file_name', length: 200 })
  fileName: string;

  // Decided by the server from the checked file type, never taken from the browser
  @Field()
  @Column({ name: 'mime_type', length: 120 })
  mimeType: string;

  // In bytes
  @Field(() => Int)
  @Column({ type: 'int' })
  size: number;

  // The random name of the file in storage. No @Field: the API never shows it.
  @Column({ name: 'storage_key', length: 64, unique: true })
  storageKey: string;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Deleting the task deletes this row (its file is then cleaned up, see AttachmentsService)
  @ManyToOne(() => Task, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Field(() => Int)
  @Column({ name: 'task_id', type: 'int' })
  taskId: number;
}
