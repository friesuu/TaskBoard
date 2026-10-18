import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { User } from '../users/user.entity';

// The same login check as GqlAuthGuard, for normal (non-GraphQL) addresses such as file upload and download.
// It reads the login cookie, finds the user, and puts them on the request (req.user).
// No cookie, a bad one, or one from before a password change: 401 Unauthorized.
@Injectable()
export class HttpAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    req.user = await this.authService.userFromToken(req.cookies?.token);
    return true;
  }
}
