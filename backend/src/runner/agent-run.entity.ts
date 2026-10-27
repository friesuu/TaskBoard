import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Task } from '../tasks/task.entity';

// One run of the Claude runner: one step (writing a prompt, or building) on one task. The runner opens it
// when the step starts, so the AI Activity page shows it as running, sends its step-by-step log while it
// goes (AgentRunLog), and closes it with the result.
@ObjectType()
@Entity('agent_runs')
@Index(['taskId', 'finishedAt']) // a task's runs
export class AgentRun {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  // The task's id, title and board, for the AI Activity page. Only loaded there.
  @Field(() => Task)
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

  // running (going on now), succeeded or failed
  @Field()
  @Column({ type: 'varchar', length: 10, default: 'running' })
  status: string;

  // What happened, in a few words: "prompt saved", "built", "stopped early", "usage limit"...
  @Field()
  @Column({ type: 'varchar', length: 40 })
  result: string;

  // The board's project it ran on (a name from projects.json on your laptop)
  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  project: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  branch: string | null;

  // Build steps only: did the runner's own build and test check pass?
  @Field(() => Boolean, { nullable: true })
  @Column({ name: 'checks_passed', type: 'boolean', nullable: true })
  checksPassed: boolean | null;

  // What Claude Code says the step cost (API) or used up (Pro plan). A float, not a money type: it's an
  // estimate for you to see.
  @Field(() => Float, { nullable: true })
  @Column({ name: 'cost_usd', type: 'double precision', nullable: true })
  costUsd: number | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  error: string | null;

  // Builds: what changed, which files, the checks and how to try it (shown in the task's AI tab)
  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Field()
  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  // Empty while the run is going on
  @Field(() => Date, { nullable: true })
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
