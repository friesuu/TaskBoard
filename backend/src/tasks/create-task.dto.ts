import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsEnum,
  Matches,
  IsDateString,
  IsInt,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { TaskStatus } from './tasks-status.enum';
import { Field, InputType, Int } from '@nestjs/graphql';

@InputType('CreateTaskInput')
export class CreateTaskDto {
  // Which board the task goes on (must be one of yours)
  @Field(() => Int)
  @IsInt()
  boardId: number;

  @Field()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  // Shown as "Notes" in the app
  @Field(() => String, {nullable: true})
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @Field(() => TaskStatus, { nullable: true })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @Field(() => String, {nullable: true})
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dueDate must be in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true })
  dueDate?: string;
}
