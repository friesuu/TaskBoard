import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';

// Rate limiting ("at most N requests per minute") for GraphQL operations.
// ThrottlerGuard expects a normal HTTP request; with GraphQL, the request and response
// live in the GraphQL context (the { req, res } from app.module), so we hand them over from there.
@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  protected getRequestResponse(context: ExecutionContext) {
    const { req, res } = GqlExecutionContext.create(context).getContext<{ req: Request; res: Response }>();
    return { req, res };
  }

  // Who the limit counts for: the logged-in user when we know them (e.g. the chat, after GqlAuthGuard),
  // otherwise the IP address (e.g. login, where nobody is logged in yet)
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user ? `user-${req.user.id}` : (req.ip ?? 'unknown');
  }
}
