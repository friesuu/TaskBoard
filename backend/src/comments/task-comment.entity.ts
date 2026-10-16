import { Field, Int, ObjectType } from '@nestjs/graphql';
import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';

// A comment on a task. Called TaskComment in the code because "Comment" already exists in TypeScript
// (it's a browser type), and mixing the two up would fail in confusing ways. In GraphQL it's just "Comment".
@ObjectType('Comment')
@Entity('comments')
@Index(['taskId', 'createdAt']) // comments are always loaded as "this task's comments, oldest first"
export class TaskComment {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  @Field()
  @Column({ type: 'text' })
  body: string;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Changes when the comment is edited, so the app can show "(edited)"
  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Task, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Field(() => Int)
  @Column({ name: 'task_id', type: 'int' })
  taskId: number;

  // Who wrote it (shown with the comment). Only they can edit or delete it.
  @Field(() => User)
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author: User;

  @Column({ name: 'author_id', type: 'int' })
  authorId: number;
}
