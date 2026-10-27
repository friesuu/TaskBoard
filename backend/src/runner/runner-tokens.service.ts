import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { RunnerToken } from './runner-token.entity';
import { User } from '../users/user.entity';

// Every runner token starts with this, so one is easy to recognise (e.g. if it ever ends up somewhere it shouldn't)
const PREFIX = 'tbr_';

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class RunnerTokensService {
  constructor(
    @InjectRepository(RunnerToken)
    private readonly tokensRepository: Repository<RunnerToken>,
  ) {}

  // Your token's details (never the token itself), or null if you haven't created one
  info(ownerId: number): Promise<RunnerToken | null> {
    return this.tokensRepository.findOneBy({ ownerId });
  }

  // A new token, replacing any old one. Returned here once and never again: only its hash is saved.
  async create(ownerId: number): Promise<string> {
    const token = PREFIX + randomBytes(32).toString('base64url');
    await this.tokensRepository.manager.transaction(async (manager) => {
      await manager.delete(RunnerToken, { ownerId });
      await manager.save(manager.create(RunnerToken, { ownerId, tokenHash: hashOf(token) }));
    });
    return token;
  }

  async revoke(ownerId: number): Promise<void> {
    await this.tokensRepository.delete({ ownerId });
  }

  // Who a token belongs to. A missing, malformed, revoked or made-up token gives the same 401.
  async userForToken(token?: string): Promise<User> {
    if (!token?.startsWith(PREFIX)) throw new UnauthorizedException();
    const row = await this.tokensRepository.findOne({ where: { tokenHash: hashOf(token) }, relations: { owner: true } });
    if (!row) throw new UnauthorizedException();
    await this.tokensRepository.update(row.id, { lastUsedAt: new Date() });
    return row.owner;
  }
}
