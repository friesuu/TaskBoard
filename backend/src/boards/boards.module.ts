import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Board } from './board.entity';
import { BoardsService } from './boards.service';
import { BoardsResolver } from './boards.resolver';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Board]), AuthModule],
  providers: [BoardsService, BoardsResolver],
  exports: [BoardsService], // tasks need it to check "is this board yours?"
})
export class BoardsModule {}
