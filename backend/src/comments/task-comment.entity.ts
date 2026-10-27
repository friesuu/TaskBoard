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

  // comment: yours, under Comments. The task's AI tab has the other two, which can't be edited:
  //   feedback: what you told Claude when you rejected its prompt
  //   claude:   a note from the Claude runner, from before it had its own log (stored under your account,
  //             since the runner acts for you)
  @Field()
  @Column({ type: 'varchar', length: 10, default: 'comment' })
  kind: string;

  // Written by the Claude runner (shown as "Claude")
  @Field()
  get fromRunner(): boolean {
    return this.kind === 'claude';
  }
}
