import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType('BoardNameInput')
export class BoardNameDto {
  @Field()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
