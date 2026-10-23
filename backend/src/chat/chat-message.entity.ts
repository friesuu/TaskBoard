import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

@ObjectType()
@Entity('chat_messages')
export class ChatMessage {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  // 'user' = you wrote it, 'assistant' = Claude wrote it (the names the Claude API uses)
  @Field(() => String)
  @Column({ type: 'varchar', length: 10 })
  role: 'user' | 'assistant';

  @Field()
  @Column({ type: 'text' })
  content: string;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // How long Claude took to answer, in milliseconds. Only on assistant replies; null on your messages and older replies.
  @Field(() => Int, { nullable: true })
  @Column({ name: 'response_ms', type: 'int', nullable: true })
  responseMs: number | null;

  // Same ownership pattern as tasks. No @Field: the API never shows it.
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Column({ name: 'owner_id', type: 'int' })
  ownerId: number;
}