import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  JoinColumn,
  ManyToOne,
  ManyToMany,
  JoinTable,
  VirtualColumn,
} from 'typeorm';
import { TaskStatus } from './tasks-status.enum';
import { Field, Int, ObjectType } from '@nestjs/graphql';
import { User } from '../users/user.entity';
import { Board } from '../boards/board.entity';
import { Label } from '../labels/label.entity';

@ObjectType()
@Entity('tasks')
@Index(['boardId', 'status', 'position']) // the board loads "this board's tasks, per column, in order" all the time
export class Task {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  @Field()
  @Column({ length: 100 })
  title: string;

  @Field(() => String, {nullable: true})
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Field(() => TaskStatus)
  @Column({
    type: 'enum',
    enum: TaskStatus,
    default: TaskStatus.TODO,
  })
  status: TaskStatus;

  @Field(() => String, {nullable: true})
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  // Order inside its column: 0 = top. Only compared between tasks on the same board with the same status.
  @Field(() => Int)
  @Column({ type: 'int', default: 0 })
  position: number;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // When the task was moved into Done (null while it isn't done). Gives the profile's "finished this week".
  // Tasks that were already done before this column existed have null: when they were finished is unknown.
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  // ----- The Claude runner (only used on tasks with the "AI" label) -----

  // The prompt Claude wrote for this task. You can edit it (e.g. fill in its blanks) while it's in Prompt Review.
  @Field(() => String, { nullable: true })
  @Column({ name: 'refined_prompt', type: 'text', nullable: true })
  refinedPrompt: string | null;

  // You clicked "Request changes": Claude revises the prompt on its next run ("Revising…" on the card)
  @Field()
  @Column({ name: 'changes_requested', default: false })
  changesRequested: boolean;

  // The exact prompt you approved. The runner only ever builds this text. Editing the prompt clears it.
  // No @Field: only the runner needs it, and it gets it through its own API.
  @Column({ name: 'approved_prompt', type: 'text', nullable: true })
  approvedPrompt: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'prompt_approved_at', type: 'timestamptz', nullable: true })
  promptApprovedAt: Date | null;

  // The git branch Claude built this task on, e.g. "ai/task-42-add-search". Set when the build starts.
  @Field(() => String, { nullable: true })
  @Column({ name: 'ai_branch', type: 'varchar', length: 100, nullable: true })
  aiBranch: string | null;

  // Why the runner stopped on this task (e.g. "spend cap reached"). While set, the runner skips the task
  // until you click "Try again".
  @Field(() => String, { nullable: true })
  @Column({ name: 'ai_error', type: 'text', nullable: true })
  aiError: string | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' }) // Many tasks belong to one user
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Column({ name: 'owner_id', type: 'int', nullable: false })
  ownerId: number;

  // The board the task is on. Deleting a board deletes its tasks.
  // We keep owner_id too, so every existing "only my tasks" check keeps working unchanged.
  @ManyToOne(() => Board, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'board_id' })
  board: Board;

  @Field(() => Int)
  @Column({ name: 'board_id', type: 'int' })
  boardId: number;

  // Checklist progress for the card ("2/5"). Not stored: the database counts it in the same query
  // that loads the task, so showing the board stays one query however many tasks there are.
  @Field(() => Int)
  @VirtualColumn({
    type: 'int',
    query: (alias) => `SELECT COUNT(*)::int FROM "checklist_items" WHERE "task_id" = ${alias}.id`,
  })
  checklistTotal: number;

  @Field(() => Int)
  @VirtualColumn({
    type: 'int',
    query: (alias) => `SELECT COUNT(*)::int FROM "checklist_items" WHERE "task_id" = ${alias}.id AND "done"`,
  })
  checklistDone: number;

  // How many files are attached (the 📎 count on the card), counted the same way
  @Field(() => Int)
  @VirtualColumn({
    type: 'int',
    query: (alias) => `SELECT COUNT(*)::int FROM "attachments" WHERE "task_id" = ${alias}.id`,
  })
  attachmentCount: number;

  // The task's labels. The link lives in a separate "task_labels" table (one row per task + label);
  // deleting a task or a label removes its rows there.
  @Field(() => [Label])
  @ManyToMany(() => Label)
  @JoinTable({
    name: 'task_labels',
    joinColumn: { name: 'task_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'label_id', referencedColumnName: 'id' },
  })
  labels: Label[];
}
