import { Field, InputType, Int, registerEnumType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { TaskStatus } from './tasks-status.enum';

// The due-date filter: one of these at a time
export enum DueFilter {
  OVERDUE = 'overdue',     // due before today and not done
  TODAY = 'today',         // due today
  THIS_WEEK = 'this_week', // due Monday to Sunday of this week
  NO_DATE = 'no_date',     // no due date
}

registerEnumType(DueFilter, { name: 'DueFilter' });

// Everything is optional; filters that are set are combined (a task must match all of them).
@InputType('TaskFilterInput')
export class TaskFilterDto {
  // Searches the title, the notes and the checklist items (capitals don't matter)
  @Field(() => String, { nullable: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  // Tasks with ANY of these labels
  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  labelIds?: number[];

  // Tasks in any of these columns
  @Field(() => [TaskStatus], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(TaskStatus, { each: true })
  statuses?: TaskStatus[];

  @Field(() => DueFilter, { nullable: true })
  @IsOptional()
  @IsEnum(DueFilter)
  due?: DueFilter;
}
