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
