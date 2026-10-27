import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Task } from '../tasks/task.entity';

// One line of the Claude runner's log: one step (writing a prompt, or building) on one task.
// The runner reports it when the step ends; the task panel shows them under "Run log".
@ObjectType()
@Entity('agent_runs')
@Index(['taskId', 'finishedAt']) // always loaded as "this task's runs, newest first"
export class AgentRun {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Task, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Field(() => Int)
  @Column({ name: 'task_id', type: 'int' })
  taskId: number;

  // "refine" (writing the prompt) or "build"
  @Field()
  @Column({ type: 'varchar', length: 10 })
  step: string;

  // What happened, in a few words: "prompt saved", "built", "stopped early", "usage limit"...
  @Field()
  @Column({ type: 'varchar', length: 40 })
  result: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  branch: string | null;

  // Build steps only: did the runner's own build and test check pass?
  @Field(() => Boolean, { nullable: true })
  @Column({ name: 'checks_passed', type: 'boolean', nullable: true })
  checksPassed: boolean | null;

  // What Claude Code says the step cost (API mode). A float, not a money type: it's an estimate for you to see.
  @Field(() => Float, { nullable: true })
  @Column({ name: 'cost_usd', type: 'double precision', nullable: true })
  costUsd: number | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Field()
  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Field()
  @CreateDateColumn({ name: 'finished_at', type: 'timestamptz' })
  finishedAt: Date;
}
