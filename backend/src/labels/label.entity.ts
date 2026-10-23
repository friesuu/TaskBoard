import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Board } from '../boards/board.entity';
import { LabelColor } from './label-color.enum';

// A label, e.g. "Urgent" in orange. Labels belong to a board; a task can have several.
@ObjectType()
@Entity('labels')
@Index(['boardId', 'name'], { unique: true }) // the database refuses two labels with the same name on a board
export class Label {
  @Field(() => Int)
  @PrimaryGeneratedColumn()
  id: number;

  @Field()
  @Column({ length: 30 })
  name: string;

  @Field(() => LabelColor)
  @Column({ type: 'enum', enum: LabelColor, default: LabelColor.GRAY })
  color: LabelColor;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Deleting a board deletes its labels. "Is this yours?" is answered through the board's owner.
  @ManyToOne(() => Board, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'board_id' })
  board: Board;

  @Field(() => Int)
  @Column({ name: 'board_id', type: 'int' })
  boardId: number;
}


// Basically describe all the columns of the table
// It just tells TypeORM how to read and write that table's row

