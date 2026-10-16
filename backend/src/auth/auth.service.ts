import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { RegisterDto } from './register.dto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './login.dto';
import { ChangePasswordDto } from './change-password.dto';
import { Board } from '../boards/board.entity';
import { DEFAULT_BOARD_NAME } from '../boards/boards.service';

@Injectable()
export class AuthService {
  // A real argon2 hash of a throwaway string, so "no such user" takes as long as "wrong password"
  private readonly dummyHash = argon2.hash('not-a-real-password');

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<User> {
    const existing = await this.usersRepository.findOneBy({ email: dto.email });
    if (existing) throw new ConflictException('Email is already registered');

    // .hash is slow on purpose: fine for one login, very slow for an attacker trying millions of passwords
    const passwordHash = await argon2.hash(dto.password);

    // The user and their first board are saved together: never a user with no board
    return this.usersRepository.manager.transaction(async (manager) => {
      const user = await manager.save(manager.create(User, { email: dto.email, passwordHash }));
      await manager.save(manager.create(Board, { name: DEFAULT_BOARD_NAME, ownerId: user.id }));
      return user;
    });
  }

  async login(dto: LoginDto): Promise<{ user: User; token: string }> {
    const user = await this.usersRepository.findOneBy({ email: dto.email });
    const valid = await argon2.verify(user?.passwordHash ?? await this.dummyHash, dto.password);
    if (!user || !valid) throw new UnauthorizedException('Invalid email or password');

    return { user, token: await this.signToken(user) };
  }

  async userFromToken(token?: string): Promise<User> {
    if (!token) throw new UnauthorizedException();
    try {
      const { sub, ver } = await this.jwtService.verifyAsync<{ sub: number; ver?: number }>(token);
      const user = await this.usersRepository.findOneBy({ id: sub });
      // The token must be from the CURRENT password: after a password change, tokenVersion has gone up,
      // so tokens made before it (another device, or a stolen copy) no longer match.
      if (user && user.tokenVersion === ver) return user;
    } catch {
      // forged or expired token: fall through
    }
    throw new UnauthorizedException();
  }

  // Returns a fresh token, so the person who changed the password stays logged in on THIS device
  async changePassword(user: User, dto: ChangePasswordDto): Promise<string> {
    const valid = await argon2.verify(user.passwordHash, dto.currentPassword);
    // BadRequest, not Unauthorized: the frontend treats "unauthenticated" as "session expired" and logs you out
    if (!valid) throw new BadRequestException('Current password is incorrect');
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('New password must be different from the current one');
    }

    user.passwordHash = await argon2.hash(dto.newPassword);
    user.tokenVersion += 1; // every token made before this moment stops working
    await this.usersRepository.save(user);

    return this.signToken(user);
  }

  // The login token: who you are (sub) and which password "generation" it belongs to (ver)
  private signToken(user: User): Promise<string> {
    return this.jwtService.signAsync({ sub: user.id, ver: user.tokenVersion });
  }
}
