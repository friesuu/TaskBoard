import { Field, ObjectType } from '@nestjs/graphql';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryColumn } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';

// What your runner (on your laptop) last said it was doing. One row per user. The runner updates it on
// every check (every 30 seconds in watch mode, and every 30 seconds while a step runs), so lastSeenAt also
// tells whether it's online.
@Entity('agent_status')
export class AgentStatus {
  @PrimaryColumn({ name: 'user_id', type: 'int' })
  userId: number;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // idle, working, paused (Pro usage limit), unplugged (on battery) or capped (today's spend cap)
  @Column({ type: 'varchar', length: 12 })
  state: string;

  // While working: which task, and which step
  @ManyToOne(() => Task, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'task_id' })
  task: Task | null;

  @Column({ name: 'task_id', type: 'int', nullable: true })
  taskId: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  step: string | null;

  @Column({ name: 'paused_until', type: 'timestamptz', nullable: true })
  pausedUntil: Date | null;

  // Since when it's been in this state (e.g. "working for 1m 05s")
  @Column({ name: 'state_since', type: 'timestamptz' })
  stateSince: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;
}

// What the app shows: the state above, "offline" when the runner hasn't checked in for a while (normal:
// it runs on your laptop), or "never" when no runner has ever checked in
@ObjectType()
export class AgentStatusInfo {
  @Field()
  state: string;

  @Field(() => Task, { nullable: true })
  task: Task | null;

  @Field(() => String, { nullable: true })
  step: string | null;

  @Field(() => Date, { nullable: true })
  pausedUntil: Date | null;

  @Field(() => Date, { nullable: true })
  stateSince: Date | null;

  @Field(() => Date, { nullable: true })
  lastSeenAt: Date | null;
}
