import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { Board } from './board.entity';
import { BoardsService } from './boards.service';
import { BoardNameDto } from './board-name.dto';
import { BoardProjectDto } from './board-project.dto';

@UseGuards(GqlAuthGuard)
@Resolver(() => Board)
export class BoardsResolver {
  constructor(private readonly boardsService: BoardsService) {}

  @Query(() => [Board])
  boards(@CurrentUser() user: User): Promise<Board[]> {
    return this.boardsService.findAll(user.id);
  }

  @Mutation(() => Board)
  createBoard(@CurrentUser() user: User, @Args('input') input: BoardNameDto): Promise<Board> {
    return this.boardsService.create(user.id, input.name);
  }

  @Mutation(() => Board)
  renameBoard(
    @CurrentUser() user: User,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: BoardNameDto,
  ): Promise<Board> {
    return this.boardsService.rename(id, user.id, input.name);
  }

  // Which project the Claude runner works in for this board ("" = none)
  @Mutation(() => Board)
  setBoardProject(
    @CurrentUser() user: User,
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: BoardProjectDto,
  ): Promise<Board> {
    return this.boardsService.setProject(id, user.id, input.project);
  }

  @Mutation(() => Boolean)
  async deleteBoard(@CurrentUser() user: User, @Args('id', { type: () => Int }) id: number): Promise<boolean> {
    await this.boardsService.remove(id, user.id);
    return true;
  }
}
