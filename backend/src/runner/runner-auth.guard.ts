import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { User } from '../users/user.entity';
import { RunnerTokensService } from './runner-tokens.service';

// The login check for the runner's own GraphQL operations (runner.resolver.ts only).
// The runner isn't a browser, so it has no login cookie: it sends its token in a header,
// "Authorization: Bearer tbr_...". GqlAuthGuard never accepts this token, so the token can't
// reach anything else (deleting tasks, changing your password...).
@Injectable()
export class RunnerAuthGuard implements CanActivate {
  constructor(private readonly tokensService: RunnerTokensService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { req } = GqlExecutionContext.create(context).getContext<{ req: Request & { user?: User } }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    req.user = await this.tokensService.userForToken(token); // @CurrentUser() reads it from here
    return true;
  }
}
