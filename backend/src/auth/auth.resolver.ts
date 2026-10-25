import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { User } from "../users/user.entity";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./register.dto";
import { LoginDto } from "./login.dto";
import { ChangePasswordDto } from "./change-password.dto";
import { TimeZoneDto } from "./time-zone.dto";
import type { Response } from 'express';
import { UseGuards } from "@nestjs/common";
import { GqlAuthGuard } from "./gql-auth.guard";
import { CurrentUser } from "./current-user.decorator";
import { GqlThrottlerGuard } from "../common/gql-throttler.guard";
import { clearLoginCookie, setLoginCookie } from "./auth-cookies";

@Resolver(() => User)
export class AuthResolver
{
    constructor(private readonly authService: AuthService){}

    // Rate limited (5 per minute per IP address): stops scripts creating accounts in bulk
    @Mutation(() => User)
    @UseGuards(GqlThrottlerGuard)
    register(@Args('input') input: RegisterDto): Promise<User>
    {
        return this.authService.register(input);
    }

    // Rate limited (5 per minute per IP address): stops password guessing
    @Mutation(() => User)
    @UseGuards(GqlThrottlerGuard)
    async login(@Args('input') input: LoginDto, @Context() ctx: { res: Response }): Promise<User>
    {
        const { user, token } = await this.authService.login(input);
        setLoginCookie(ctx.res, token);
        return user;
    }

    @Query(() => User)
    @UseGuards(GqlAuthGuard)
    me(@CurrentUser() user: User): User
    {
        return user;
    }

    // The browser sends its time zone after logging in, so "today" means today for this user
    @Mutation(() => User)
    @UseGuards(GqlAuthGuard)
    setTimeZone(@CurrentUser() user: User, @Args('input') input: TimeZoneDto): Promise<User>
    {
        return this.authService.setTimeZone(user, input.timeZone);
    }

    @Mutation(() => Boolean)
    logout(@Context() ctx: { res: Response }): boolean
    {
        clearLoginCookie(ctx.res);
        return true;
    }

    // Logged in only (guard). Other devices are logged out; this one gets a fresh cookie and stays in.
    // Rate limited per user (5 per minute): someone at your unlocked computer can't guess your current password.
    // GqlAuthGuard runs first, so the limit knows who you are.
    @Mutation(() => Boolean)
    @UseGuards(GqlAuthGuard, GqlThrottlerGuard)
    async changePassword(
        @CurrentUser() user: User,
        @Args('input') input: ChangePasswordDto,
        @Context() ctx: { res: Response },
    ): Promise<boolean>
    {
        const token = await this.authService.changePassword(user, input);
        setLoginCookie(ctx.res, token);
        return true;
    }
}
