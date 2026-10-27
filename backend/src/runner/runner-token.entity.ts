import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

// The Claude runner's key to your task board: one per user. Never exposed through GraphQL.
// Only a hash of the token is stored, like a password: the token itself is shown once, when it's created.
@Entity('runner_tokens')
export class RunnerToken {
  @PrimaryGeneratedColumn()
  id: number;

  // SHA-256 of the token. A fast hash is fine here (unlike passwords) because the token is 32 random bytes:
  // nobody can guess it, so there's nothing to slow down. It also lets us find the row by its hash.
  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Updated whenever the runner uses the token, so you can see it's alive (or spot use you didn't expect)
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  // unique: one token per user. Creating a new one replaces (revokes) the old one.
  @Column({ name: 'owner_id', type: 'int', unique: true })
  ownerId: number;
}
