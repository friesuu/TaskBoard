import { Field, InputType, Int } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType('SendChatMessageInput')
export class SendChatMessageDto {
  // The board you're looking at: the assistant only sees and changes tasks on this board
  @Field(() => Int)
  @IsInt()
  boardId: number;

  @Field()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000) // keeps each request, and its cost, small
  message: string;
}