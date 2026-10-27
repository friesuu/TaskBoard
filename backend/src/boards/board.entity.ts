import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

// A board ("Work", "Home"...). Every board has its own To do / In progress / Done columns and tasks.
@ObjectType()
@Entity('boards')
export class Board {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  @Field()
  @Column({ length: 100 })
  name: string;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Which project folder the Claude runner works in for this board's "AI" tasks, e.g. "notes-app".
  // Only a NAME: the runner looks it up in its own projects.json, so no folder path is ever stored here.
  // null = no project: the runner leaves this board alone.
  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  project: string | null;

  // Same ownership pattern as tasks. No @Field: the API never shows it.
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Column({ name: 'owner_id', type: 'int' })
  ownerId: number;
}
