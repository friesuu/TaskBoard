import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { GqlExecutionContext } from "@nestjs/graphql";
import type { Request } from 'express';
import { User } from "../users/user.entity";
import { AUTH_COOKIE } from "./auth-cookies";

@Injectable()
export class GqlAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { req } = GqlExecutionContext.create(context).getContext<{ req: Request & { user?: User } }>();
    req.user = await this.authService.userFromToken(req.cookies?.[AUTH_COOKIE]);
    return true;
  }
}