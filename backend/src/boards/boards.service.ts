import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Board } from './board.entity';

export const DEFAULT_BOARD_NAME = 'My board';

@Injectable()
export class BoardsService {
  constructor(
    @InjectRepository(Board)
    private readonly boardsRepository: Repository<Board>,
  ) {}

  // Your boards, oldest first (the first one is where you land by default)
  findAll(ownerId: number): Promise<Board[]> {
    return this.boardsRepository.find({ where: { ownerId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }

  // One of YOUR boards. Someone else's board gives the same "not found" as a board that doesn't exist.
  async findOwned(id: number, ownerId: number): Promise<Board> {
    const board = await this.boardsRepository.findOneBy({ id, ownerId });
    if (!board) throw new NotFoundException(`Board ${id} not found`);
    return board;
  }

  create(ownerId: number, name: string): Promise<Board> {
    return this.boardsRepository.save(this.boardsRepository.create({ ownerId, name }));
  }

  async rename(id: number, ownerId: number, name: string): Promise<Board> {
    const board = await this.findOwned(id, ownerId);
    board.name = name;
    return this.boardsRepository.save(board);
  }

  // The DTO has already checked it's a plain project name. Empty = no project.
  async setProject(id: number, ownerId: number, project: string): Promise<Board> {
    const board = await this.findOwned(id, ownerId);
    board.project = project === '' ? null : project;
    return this.boardsRepository.save(board);
  }

  // Deletes the board and (ON DELETE CASCADE) its tasks. You always keep at least one board.
  async remove(id: number, ownerId: number): Promise<void> {
    await this.findOwned(id, ownerId);
    if ((await this.boardsRepository.countBy({ ownerId })) <= 1) {
      throw new BadRequestException("You can't delete your last board");
    }
    await this.boardsRepository.delete({ id, ownerId });
  }
}
