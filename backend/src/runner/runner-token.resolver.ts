import { UseGuards } from '@nestjs/common';
import { Field, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { RunnerTokensService } from './runner-tokens.service';

// What the profile shows about your runner token (never the token itself)
@ObjectType()
class RunnerTokenInfo {
  @Field()
  createdAt: Date;

  @Field(() => Date, { nullable: true })
  lastUsedAt: Date | null;
}

// Managing the token from the profile page. Logged in with your normal cookie: the runner's own token
// can't create or revoke tokens.
@UseGuards(GqlAuthGuard)
@Resolver()
export class RunnerTokenResolver {
  constructor(private readonly tokensService: RunnerTokensService) {}

  @Query(() => RunnerTokenInfo, { nullable: true })
  runnerToken(@CurrentUser() user: User): Promise<RunnerTokenInfo | null> {
    return this.tokensService.info(user.id);
  }

  // Returns the new token: the only time it's ever shown. Replaces (revokes) any old one.
  @Mutation(() => String)
  createRunnerToken(@CurrentUser() user: User): Promise<string> {
    return this.tokensService.create(user.id);
  }

  @Mutation(() => Boolean)
  async revokeRunnerToken(@CurrentUser() user: User): Promise<boolean> {
    await this.tokensService.revoke(user.id);
    return true;
  }
}
