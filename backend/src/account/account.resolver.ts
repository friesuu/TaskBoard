import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { User } from '../users/user.entity';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { GqlThrottlerGuard } from '../common/gql-throttler.guard';
import { clearLoginCookie } from '../auth/auth-cookies';
import { AccountService } from './account.service';
import { DisplayNameDto } from './display-name.dto';
import { DeleteAccountDto } from './delete-account.dto';

@Resolver(() => User)
export class AccountResolver {
  constructor(private readonly accountService: AccountService) {}

  @Mutation(() => User)
  @UseGuards(GqlAuthGuard)
  setDisplayName(@CurrentUser() user: User, @Args('input') input: DisplayNameDto): Promise<User> {
    return this.accountService.setDisplayName(user, input.displayName);
  }

  // Asks for the password again, and is rate limited per user (5 per minute) so nobody at your
  // unlocked computer can guess it. GqlAuthGuard runs first, so the limit knows who you are.
  // Afterwards the login cookie is removed: the account it belonged to is gone.
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard, GqlThrottlerGuard)
  async deleteAccount(
    @CurrentUser() user: User,
    @Args('input') input: DeleteAccountDto,
    @Context() ctx: { res: Response },
  ): Promise<boolean> {
    await this.accountService.deleteAccount(user, input.password);
    clearLoginCookie(ctx.res);
    return true;
  }
}
