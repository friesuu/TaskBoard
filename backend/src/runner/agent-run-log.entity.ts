import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AgentRun } from './agent-run.entity';

// One line of a run's step-by-step log: something Claude said or did, or one of the runner's own steps
// (setup, checks, commit). The runner sends them a few at a time while the run goes on. Anything that looks
// like a secret is scrubbed before it's saved (redact.ts).
@ObjectType()
@Entity('agent_run_logs')
@Index(['runId', 'id']) // always loaded as "this run's lines, in order"
export class AgentRunLog {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => AgentRun, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: AgentRun;

  @Field(() => Int)
  @Column({ name: 'run_id', type: 'int' })
  runId: number;

  // When it happened (the runner's clock)
  @Field()
  @Column({ type: 'timestamptz' })
  at: Date;

  // One of LOG_KINDS (runner.dto.ts): info, claude, thinking, tool, check or error
  @Field()
  @Column({ type: 'varchar', length: 10 })
  kind: string;

  @Field()
  @Column({ type: 'text' })
  text: string;
}
