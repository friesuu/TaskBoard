import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Task } from '../tasks/task.entity';

// One line of a task's checklist, e.g. "[x] Book the room"
@ObjectType()
@Entity('checklist_items')
@Index(['taskId', 'position']) // a checklist is always loaded as "this task's items, in order"
export class ChecklistItem {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  @Field()
  @Column({ length: 200 })
  text: string;

  @Field()
  @Column({ default: false })
  done: boolean;

  // Order in the checklist: 0 = top
  @Field(() => Int)
  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Belongs to one task; deleting the task deletes its checklist.
  // No owner_id here: "is this yours?" is answered through the task's owner.
  @ManyToOne(() => Task, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Field(() => Int)
  @Column({ name: 'task_id', type: 'int' })
  taskId: number;
}
