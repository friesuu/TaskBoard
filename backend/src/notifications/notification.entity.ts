import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';

// Only things you need to act on or know about, never every step:
//   prompt_ready  a prompt is waiting for your approval
//   review_ready  a task is built and ready for you to review
//   run_failed    a run failed (the runner stopped, or the build's checks failed)
//   usage_limit   the Pro plan's usage limit was reached: the runner waits until it resets
export type NotificationKind = 'prompt_ready' | 'review_ready' | 'run_failed' | 'usage_limit';

// One notification in the header's bell. Called UserNotification in the code because "Notification" is
// already a browser type in TypeScript (like Comment, see TaskComment). In GraphQL it's just "Notification".
@ObjectType('Notification')
@Entity('notifications')
@Index(['userId', 'createdAt']) // always loaded as "your newest notifications"
export class UserNotification {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  // The task it's about (its id, title and board), or none ("usage limit reached")
  @Field(() => Task, { nullable: true })
  @ManyToOne(() => Task, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task | null;

  @Field(() => Int, { nullable: true })
  @Column({ name: 'task_id', type: 'int', nullable: true })
  taskId: number | null;

  @Field()
  @Column({ type: 'varchar', length: 20 })
  kind: string;

  @Field()
  @Column({ type: 'varchar', length: 200 })
  message: string;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Empty until you've read it
  @Field(() => Date, { nullable: true })
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;
}
